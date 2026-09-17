"""CLI entry point for the workshop backend.

Run from the repo root (so `capx` and `workshop` both resolve as packages):

    uv run python -m workshop.backend.main

The backend itself doesn't need capx or the Robosuite venv (see
workshop/README.md's Layout section) — only the sandbox worker image does.
Perception API access is via the fixed `perception-proxy-*` containers (see
session_manager.py's module docstring), not host env vars.

Prompt-engineering mode (see llm_client.py) calls a local, OpenAI-compatible
vLLM server directly from this process over the LAN — set these before
starting the backend if it's not at the default address:

    WORKSHOP_VLLM_BASE_URL  (default: http://127.0.0.1:8000/v1)
    WORKSHOP_VLLM_MODEL     (default: "default" — vLLM's served model name)
    WORKSHOP_VLLM_API_KEY   (optional; vLLM ignores it by default)

vLLM itself is never exposed beyond the LAN — only this backend process
talks to it.
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

    gpu_uuids: str = ""
    """Comma-separated GPU UUIDs (`nvidia-smi -L`, e.g.
    "GPU-a3d5df43-3bd7-e5f3-36be-58142a58a0d2") that session containers are
    allowed to use, assigned round-robin as sessions start — one UUID means
    every session pins to that one GPU; several means sessions spread across
    them. Leave empty (the default) to let every session see every GPU on
    the host (`NVIDIA_VISIBLE_DEVICES=all`), which is fine for a single-GPU
    host or when you don't need session-to-GPU isolation."""


def main(args: ServerArgs | None = None) -> None:
    if args is None:
        args = tyro.cli(ServerArgs)

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    gpu_uuids = [u.strip() for u in args.gpu_uuids.split(",") if u.strip()]
    app = create_app(gpu_uuids=gpu_uuids or None)
    logger.info(f"Starting CaP-X Workshop backend on http://{args.host}:{args.port}")
    if gpu_uuids:
        logger.info(f"Session containers will round-robin across GPUs: {gpu_uuids}")
    logger.info("WebUI dev server should be running on http://localhost:5173")

    uvicorn.run(app, host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
