"""FastAPI backend for the CaP-X workshop WebUI.

Endpoints follow WORKSHOP_WEBUI_SPEC.md section 3.2. This process itself
never executes participant code — it only starts and talks (over HTTP) to
per-session sandbox containers managed by `session_manager.py`. See that
module's docstring, `workshop/backend/docker/Dockerfile`, and
`workshop/docker/docker-compose.yml` for the actual isolation.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import requests
import websockets
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from websockets.asyncio.client import connect as ws_connect

from workshop.backend.config import REPO_ROOT, TASKS, get_task, resolve_config_path
from workshop.backend.session_manager import SessionManager

logger = logging.getLogger(__name__)

VIDEO_ROOT = Path(__file__).resolve().parent / "_replays"
REAP_INTERVAL_SECONDS = 300


class CreateSessionRequest(BaseModel):
    task_id: str


class RunCellRequest(BaseModel):
    code: str
    cell_id: str


def _require_session(app: FastAPI, session_id: str) -> SessionManager:
    manager: SessionManager = app.state.manager
    if manager.get(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return manager


def create_app(gpu_uuids: list[str] | None = None) -> FastAPI:
    app = FastAPI(title="CaP-X Workshop WebUI Backend")

    # Dev-only: the Vite dev server runs on a different origin. In production
    # the built WebUI is served from this same app (see bottom of this
    # function), so no CORS is needed there — and none is needed behind the
    # Cloudflare Tunnel either, since it's a single origin end-to-end.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.manager = SessionManager(video_root=VIDEO_ROOT, repo_root=REPO_ROOT, gpu_uuids=gpu_uuids)

    @app.on_event("startup")
    async def _start_reaper() -> None:
        async def _loop() -> None:
            while True:
                await asyncio.sleep(REAP_INTERVAL_SECONDS)
                await app.state.manager.reap_idle()

        app.state.reaper_task = asyncio.create_task(_loop())

    @app.on_event("shutdown")
    async def _stop_everything() -> None:
        task = getattr(app.state, "reaper_task", None)
        if task is not None:
            task.cancel()
        await app.state.manager.close_all()

    @app.get("/api/tasks")
    async def list_tasks() -> dict:
        return {
            "tasks": [
                {
                    "task_id": t.task_id,
                    "name": t.name,
                    "description": t.description,
                    "featured": t.featured,
                }
                for t in TASKS
            ]
        }

    @app.post("/api/sessions")
    async def create_session(request: CreateSessionRequest) -> dict:
        try:
            task = get_task(request.task_id)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Unknown task_id: {request.task_id}")

        manager: SessionManager = app.state.manager
        try:
            session = await manager.create_session(task.task_id, resolve_config_path(task))
        except Exception as exc:
            logger.exception("Failed to start session for task %s", task.task_id)
            raise HTTPException(status_code=500, detail=str(exc))

        # The sandbox container comes up idle (no simulation reset yet); do
        # the first reset here so the frontend gets an initial camera frame.
        try:
            result = await manager.reset(session.session_id)
        except Exception as exc:
            await manager.close_session(session.session_id)
            raise HTTPException(status_code=500, detail=f"Environment reset failed: {exc}")

        return {
            "session_id": session.session_id,
            "task_id": task.task_id,
            "frames": result["frames"],
            "task_prompt": result.get("task_prompt"),
            "api_docs": result.get("api_docs", ""),
        }

    @app.get("/api/sessions/{session_id}/observation")
    async def get_observation(session_id: str) -> dict:
        manager = _require_session(app, session_id)
        return await manager.observation(session_id)

    @app.websocket("/api/sessions/{session_id}/stream")
    async def stream_camera(websocket: WebSocket, session_id: str) -> None:
        """Reverse-proxies the sandbox container's /stream websocket.

        The container's port is 127.0.0.1-only (never reachable from the
        browser/LAN — see session_manager.py), so the backend has to relay
        this itself, the same way capx/web/server.py proxies Viser. Frames
        keep arriving here *while* a cell is executing (worker_server.py's
        /run_cell now runs off its event loop specifically so this can keep
        flowing concurrently), which is what lets the camera view show a
        robot's motion live instead of only a before/after snapshot.
        """
        manager: SessionManager = app.state.manager
        session = manager.get(session_id)
        if session is None:
            await websocket.close(code=4004, reason="Session not found")
            return

        await websocket.accept()
        try:
            upstream = await ws_connect(f"ws://127.0.0.1:{session.host_port}/stream")
        except Exception as exc:
            await websocket.close(code=1011, reason=str(exc))
            return

        async def _upstream_to_client() -> None:
            try:
                async for message in upstream:
                    await websocket.send_text(message)
            except (WebSocketDisconnect, websockets.exceptions.ConnectionClosed):
                pass

        async def _client_to_upstream() -> None:
            # One-directional stream (worker -> browser); this side only
            # watches for the browser disconnecting so the upstream gets
            # torn down promptly instead of lingering.
            try:
                while True:
                    await websocket.receive_text()
            except WebSocketDisconnect:
                pass

        done, pending = await asyncio.wait(
            [asyncio.create_task(_upstream_to_client()), asyncio.create_task(_client_to_upstream())],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await upstream.close()

    @app.post("/api/sessions/{session_id}/cells/run")
    async def run_cell(session_id: str, request: RunCellRequest) -> dict:
        manager = _require_session(app, session_id)
        try:
            return await manager.run_cell(session_id, request.cell_id, request.code, timeout=180)
        except requests.Timeout:
            raise HTTPException(status_code=504, detail="Cell execution timed out")
        except requests.HTTPError as exc:
            # The sandbox container's /run_cell returned non-2xx: a
            # framework-level bug, not a participant code error (those come
            # back as a normal {"ok": False, ...} 200 response instead).
            detail = exc.response.text if exc.response is not None else str(exc)
            raise HTTPException(status_code=500, detail=detail)

    @app.post("/api/sessions/{session_id}/reset")
    async def reset_session(session_id: str) -> dict:
        manager = _require_session(app, session_id)
        return await manager.reset(session_id)

    @app.post("/api/sessions/{session_id}/replay")
    async def save_replay(session_id: str) -> FileResponse:
        manager = _require_session(app, session_id)
        result = await manager.replay(session_id)
        path = result.get("path")
        if not path or not Path(path).exists():
            raise HTTPException(status_code=404, detail="No recorded frames yet")
        return FileResponse(path, media_type="video/mp4", filename=f"replay_{session_id}.mp4")

    @app.delete("/api/sessions/{session_id}")
    async def delete_session(session_id: str) -> dict:
        manager: SessionManager = app.state.manager
        await manager.close_session(session_id)
        return {"status": "closed"}

    # --------------------------------------------------------------------
    # Single-origin static serving of the built WebUI (production only).
    # See WORKSHOP_WEBUI_SPEC.md section 2/4: this is what lets the whole
    # app sit behind one Cloudflare Tunnel ingress rule.
    # --------------------------------------------------------------------
    frontend_dist = REPO_ROOT / "workshop" / "webui" / "dist"
    if frontend_dist.exists():
        app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

        @app.get("/")
        async def index() -> FileResponse:
            return FileResponse(frontend_dist / "index.html")

        @app.get("/{path:path}")
        async def spa_fallback(path: str) -> FileResponse:
            # Resolve and confirm containment before serving — `path` is
            # attacker-controlled and a naive `frontend_dist / path` join
            # allows `../` traversal outside `dist/` (unlike the `/assets`
            # mount above, which StaticFiles protects automatically).
            candidate = (frontend_dist / path).resolve()
            dist_root = frontend_dist.resolve()
            if candidate.is_relative_to(dist_root) and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(frontend_dist / "index.html")

    return app
