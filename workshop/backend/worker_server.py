"""FastAPI server that runs INSIDE the per-session sandbox container.

This is the container's entrypoint (see `workshop/backend/docker/Dockerfile`)
and the only place arbitrary participant Python code actually executes
(`EnvRuntime.run_cell()` -> `CodeExecutionEnvBase.step(code)` -> `exec()`).
It must never run directly on the backend host — the backend
(`workshop/backend/session_manager.py`) only ever talks to it over HTTP,
through the published port of a locked-down, network-isolated container
(see that module's docstring for the network design).

Building `EnvRuntime` (Robosuite/MuJoCo/EGL init) happens synchronously in
`main()`, before `uvicorn.run()` starts listening — so the moment this
process accepts connections at all, it's fully ready. The backend's
readiness check is simply "can I reach /health yet", not a separate
in-app readiness flag.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import tyro
import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from workshop.backend.env_runtime import EnvRuntime, _encode_rgb_png

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# How often the /stream websocket checks for a new frame while idle/running.
# robosuite's own sub-sampling (RobosuiteBaseEnv._SUBSAMPLE_RATE) already caps
# how often a new frame actually appears; this just caps how eagerly we poll
# for one.
STREAM_POLL_INTERVAL_SECONDS = 0.1


class RunCellRequest(BaseModel):
    cell_id: str
    code: str


class ReplayRequest(BaseModel):
    suffix: str = "combined"


def create_app(runtime: EnvRuntime) -> FastAPI:
    app = FastAPI(title="CaP-X Workshop Session Worker")

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ready"}

    @app.post("/reset")
    async def reset() -> dict:
        return await asyncio.to_thread(runtime.reset)

    @app.post("/run_cell")
    async def run_cell(request: RunCellRequest) -> dict:
        try:
            # Off the event loop: run_cell() blocks for as long as the
            # participant's code does (goto_pose() alone can be many seconds
            # of internal simulate-loop stepping), and /stream below needs
            # the loop free to keep pushing frames while that happens.
            return await asyncio.to_thread(runtime.run_cell, request.cell_id, request.code)
        except Exception as exc:  # framework-level bug, not a user code error
            # (user code errors are already caught inside CodeExecutionEnvBase
            # and come back as a normal {"ok": False, "stderr": ...} result).
            logger.exception("run_cell failed unexpectedly")
            raise HTTPException(status_code=500, detail=repr(exc)) from exc

    @app.get("/observation")
    async def observation() -> dict:
        return await asyncio.to_thread(runtime.observation)

    @app.post("/replay")
    async def replay(request: ReplayRequest) -> dict:
        return await asyncio.to_thread(runtime.replay, request.suffix)

    @app.websocket("/stream")
    async def stream(websocket: WebSocket) -> None:
        """Push each newly-recorded frame as it appears — including the
        transitional frames from mid-motion, not just the frame at the start
        and end of a cell. Reading recorded_frame_count()/recorded_frame()
        concurrently with run_cell() running in another thread is safe: they
        only do plain list len()/slicing on the frame buffer (GIL-protected),
        never touch the MuJoCo/EGL context directly.
        """
        await websocket.accept()
        camera_name = runtime.primary_camera_name()
        last_sent = -1
        try:
            while True:
                count = runtime.recorded_frame_count()
                if count > 0 and count - 1 != last_sent:
                    last_sent = count - 1
                    frame = await asyncio.to_thread(runtime.recorded_frame, last_sent)
                    if frame is not None:
                        # JSON envelope, not a bare base64 string: which
                        # `frames` key this belongs to varies per task (see
                        # EnvRuntime.primary_camera_name()) and must never be
                        # assumed on the frontend.
                        await websocket.send_json({"camera": camera_name, "image": _encode_rgb_png(frame)})
                await asyncio.sleep(STREAM_POLL_INTERVAL_SECONDS)
        except WebSocketDisconnect:
            pass

    return app


@dataclass
class ServerArgs:
    config_path: str
    """Path to the task YAML, as seen inside the container (the repo is
    mounted read-only at /workspace, see the Dockerfile/session_manager)."""

    video_dir: str = "/output"
    """Where replay videos are written — must be the container's persistent
    bind mount (see session_manager.py), not a path under the image's own
    rootfs: that layer is destroyed with the container on session end."""

    host: str = "0.0.0.0"
    port: int = 8500


def main() -> None:
    args = tyro.cli(ServerArgs)
    logger.info("Building EnvRuntime from %s ...", args.config_path)
    runtime = EnvRuntime(args.config_path, args.video_dir)
    logger.info("EnvRuntime ready, starting server on %s:%s", args.host, args.port)
    app = create_app(runtime)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
