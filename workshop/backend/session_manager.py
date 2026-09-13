"""Owns the Session Worker processes for all active WebUI sessions.

See WORKSHOP_WEBUI_SPEC.md section 3.2/3.3. One session = one spawned OS
process running `workshop.backend.worker.worker_main`. Commands to a given
session are serialized through an `asyncio.Lock` (the underlying protocol is
a plain request/response over multiprocessing Queues, not designed for
concurrent callers), and blocking Queue.get() calls are pushed onto a thread
via `asyncio.to_thread` so they don't stall the FastAPI event loop.
"""

from __future__ import annotations

import asyncio
import logging
import multiprocessing as mp
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from workshop.backend.worker import worker_main

logger = logging.getLogger(__name__)

IDLE_TIMEOUT_SECONDS = 30 * 60
READY_TIMEOUT_SECONDS = 180


@dataclass
class Session:
    session_id: str
    task_id: str
    process: mp.process.BaseProcess
    cmd_q: Any
    result_q: Any
    video_dir: Path
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_active: float = field(default_factory=time.monotonic)


class SessionManager:
    def __init__(self, video_root: Path) -> None:
        self._sessions: dict[str, Session] = {}
        self._ctx = mp.get_context("spawn")
        self._video_root = video_root

    async def create_session(self, task_id: str, config_path: str) -> Session:
        session_id = uuid.uuid4().hex[:12]
        cmd_q = self._ctx.Queue()
        result_q = self._ctx.Queue()
        video_dir = self._video_root / session_id

        proc = self._ctx.Process(
            target=worker_main,
            args=(config_path, str(video_dir), cmd_q, result_q),
            daemon=True,
        )
        proc.start()

        session = Session(
            session_id=session_id,
            task_id=task_id,
            process=proc,
            cmd_q=cmd_q,
            result_q=result_q,
            video_dir=video_dir,
        )
        self._sessions[session_id] = session

        try:
            ready = await asyncio.to_thread(result_q.get, True, READY_TIMEOUT_SECONDS)
        except Exception as exc:
            await self.close_session(session_id)
            raise RuntimeError(f"Worker did not respond within {READY_TIMEOUT_SECONDS}s") from exc

        if ready.get("type") != "ready":
            await self.close_session(session_id)
            raise RuntimeError(f"Worker failed to start: {ready.get('error', ready)}")

        logger.info("Session %s started for task %s (pid=%s)", session_id, task_id, proc.pid)
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def list_sessions(self) -> list[str]:
        return list(self._sessions.keys())

    async def send(self, session_id: str, cmd: dict[str, Any], timeout: float = 180) -> dict[str, Any]:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        # Tag every request with an id and only accept the matching reply.
        # Without this, a response that arrives after its own call already
        # timed out gets read back as the result of the *next* command sent
        # to this session, silently shifting every later result by one.
        request_id = uuid.uuid4().hex
        cmd = {**cmd, "request_id": request_id}
        async with session.lock:
            session.last_active = time.monotonic()
            session.cmd_q.put(cmd)
            deadline = time.monotonic() + timeout
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(f"Session {session_id} did not respond within {timeout}s")
                try:
                    result = await asyncio.to_thread(session.result_q.get, True, remaining)
                except Exception as exc:
                    raise TimeoutError(f"Session {session_id} did not respond within {timeout}s") from exc
                session.last_active = time.monotonic()
                if result.get("request_id") == request_id:
                    return result
                logger.warning(
                    "Session %s: discarding stale worker response %r while waiting for %s",
                    session_id,
                    result.get("type"),
                    request_id,
                )

    async def close_session(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session is None:
            return
        try:
            session.cmd_q.put({"type": "shutdown"})
        except Exception:
            pass
        await asyncio.to_thread(session.process.join, 10)
        if session.process.is_alive():
            logger.warning("Session %s did not exit cleanly, terminating", session_id)
            session.process.terminate()

    async def close_all(self) -> None:
        # Concurrent, not sequential: each close_session() has up to a 10s
        # process-join wait, so closing N sessions one at a time would make
        # shutdown time scale linearly with the number of live sessions.
        await asyncio.gather(
            *(self.close_session(sid) for sid in list(self._sessions.keys())),
            return_exceptions=True,
        )

    async def reap_idle(self) -> None:
        now = time.monotonic()
        stale = [sid for sid, s in self._sessions.items() if now - s.last_active > IDLE_TIMEOUT_SECONDS]
        for session_id in stale:
            logger.info("Reaping idle session %s", session_id)
            await self.close_session(session_id)
