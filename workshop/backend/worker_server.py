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

import logging
from dataclasses import dataclass

import tyro
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from workshop.backend.env_runtime import EnvRuntime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
        return runtime.reset()

    @app.post("/run_cell")
    async def run_cell(request: RunCellRequest) -> dict:
        try:
            return runtime.run_cell(request.cell_id, request.code)
        except Exception as exc:  # framework-level bug, not a user code error
            # (user code errors are already caught inside CodeExecutionEnvBase
            # and come back as a normal {"ok": False, "stderr": ...} result).
            logger.exception("run_cell failed unexpectedly")
            raise HTTPException(status_code=500, detail=repr(exc)) from exc

    @app.get("/observation")
    async def observation() -> dict:
        return runtime.observation()

    @app.post("/replay")
    async def replay(request: ReplayRequest) -> dict:
        return runtime.replay(request.suffix)

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
