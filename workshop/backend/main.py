"""CLI entry point for the workshop backend.

Run from the repo root (so `capx` and `workshop` both resolve as packages),
inside the Robosuite venv (`uv sync --extra robosuite`):

    uv run python -m workshop.backend.main

Perception API endpoints are read from the standard `*_SERVICE_URL`
environment variables (see .envrc.example / workshop/backend/.envrc.example)
— unchanged from the main capx setup (WORKSHOP_WEBUI_SPEC.md section 4).
"""

from __future__ import annotations

import logging

import tyro
import uvicorn
from dataclasses import dataclass

from workshop.backend.app import create_app


@dataclass
class ServerArgs:
    host: str = "0.0.0.0"
    """Host to bind the server to."""

    port: int = 8200
    """Port to run the server on.

    Matches the Cloudflare Tunnel's already-configured public hostname origin
    (see WORKSHOP_WEBUI_SPEC.md section 4.1) — change this only if you also
    update that origin in the Cloudflare dashboard. Note this is the same
    default port as the unrelated capx/web/server.py; don't run both on the
    same machine at the same time."""

    reload: bool = False
    """Enable auto-reload for development."""


def main(args: ServerArgs | None = None) -> None:
    if args is None:
        args = tyro.cli(ServerArgs)

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    app = create_app()
    logger.info(f"Starting CaP-X Workshop backend on http://{args.host}:{args.port}")
    logger.info("WebUI dev server should be running on http://localhost:5173")

    uvicorn.run(app, host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
