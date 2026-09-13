"""FastAPI backend for the CaP-X workshop WebUI.

Endpoints follow WORKSHOP_WEBUI_SPEC.md section 3.2. This is a fresh,
standalone implementation for the workshop repo (see WORKSHOP_WEBUI_SPEC.md
section 2/3.2: existing `capx/web/server.py` is not reused as a base, only
its "single origin + window.location-based WS/URL resolution" idea, which
also happens to work unchanged behind a Cloudflare Tunnel).
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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


def create_app() -> FastAPI:
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

    app.state.manager = SessionManager(video_root=VIDEO_ROOT)

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
                {"task_id": t.task_id, "name": t.name, "description": t.description}
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

        try:
            result = await manager.send(session.session_id, {"type": "reset"})
        except Exception as exc:
            await manager.close_session(session.session_id)
            raise HTTPException(status_code=500, detail=str(exc))

        if result.get("type") != "reset_ok":
            await manager.close_session(session.session_id)
            raise HTTPException(status_code=500, detail=f"Environment reset failed: {result}")

        return {
            "session_id": session.session_id,
            "task_id": task.task_id,
            "frames": result["frames"],
            "task_prompt": result.get("task_prompt"),
        }

    @app.get("/api/sessions/{session_id}/observation")
    async def get_observation(session_id: str) -> dict:
        manager = _require_session(app, session_id)
        return await manager.send(session_id, {"type": "observation"})

    @app.post("/api/sessions/{session_id}/cells/run")
    async def run_cell(session_id: str, request: RunCellRequest) -> dict:
        manager = _require_session(app, session_id)
        try:
            result = await manager.send(
                session_id,
                {"type": "run_cell", "code": request.code, "cell_id": request.cell_id},
                timeout=180,
            )
        except TimeoutError as exc:
            raise HTTPException(status_code=504, detail=str(exc))
        if result.get("type") == "error":
            raise HTTPException(status_code=400, detail=result)
        return result

    @app.post("/api/sessions/{session_id}/reset")
    async def reset_session(session_id: str) -> dict:
        manager = _require_session(app, session_id)
        return await manager.send(session_id, {"type": "reset"})

    @app.post("/api/sessions/{session_id}/replay")
    async def save_replay(session_id: str) -> FileResponse:
        manager = _require_session(app, session_id)
        result = await manager.send(session_id, {"type": "replay"}, timeout=60)
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
