"""Generalization test: runs one Agent Mode configuration against every task
of a suite, one after another, and reports per-task success (x/N).

Each task is a normal `run_agent_loop()` in its own sandbox session — this
module only creates/closes those sessions and forwards the loop's events, so
the frontend can render the currently running task live with the same view a
single Agent run uses. Events:

- `{"type": "eval_start", "eval_id", "jobs": [{"job_id", "task_id", "name"}]}`
- `{"type": "job_boot", "job_id"}` — the task's sandbox is starting.
- `{"type": "job_start", "job_id", "session_id"}` — running; the session's
  camera can be streamed from `/api/sessions/{session_id}/stream`.
- `{"type": "job_event", "job_id", "event": <run_agent_loop event>}`
- `{"type": "job_done", "job_id", "success", "status", "detail"}` — `status`
  is a LoopStatus, "skipped" (eval stopped before it began) or "error".
- `{"type": "eval_done", "stopped": bool}` — always last.

A task succeeds when the simulator's `task_completed` was true after the last
code the agent executed. If `reuse` names a session for one of the suite's
tasks, that task runs in it (and it is left open) instead of a new sandbox.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from pydantic import BaseModel

from workshop.backend.agent_loop import AgentLoopRegistry, AgentRunRequest, run_agent_loop
from workshop.backend.config import get_suite, get_task, resolve_config_path
from workshop.backend.session_manager import SessionManager

logger = logging.getLogger(__name__)


class ReuseSession(BaseModel):
    task_id: str
    session_id: str


class EvalRunRequest(BaseModel):
    suite_id: str
    task_ids: list[str] | None = None  # subset of the suite; None = the suite's default
    reuse: ReuseSession | None = None
    agent: AgentRunRequest


class EvalRegistry:
    """Stop requests + the currently running session of each evaluation."""

    def __init__(self) -> None:
        self._stop: set[str] = set()
        self._current: dict[str, str | None] = {}

    def start(self, eval_id: str) -> None:
        self._current[eval_id] = None

    def finish(self, eval_id: str) -> None:
        self._stop.discard(eval_id)
        self._current.pop(eval_id, None)

    def exists(self, eval_id: str) -> bool:
        return eval_id in self._current

    def should_stop(self, eval_id: str) -> bool:
        return eval_id in self._stop

    def set_current(self, eval_id: str, session_id: str | None) -> None:
        self._current[eval_id] = session_id

    def request_stop(self, eval_id: str, agent_registry: AgentLoopRegistry) -> None:
        self._stop.add(eval_id)
        sid = self._current.get(eval_id)
        if sid:
            agent_registry.request_stop(sid)


async def run_eval(
    manager: SessionManager,
    agent_registry: AgentLoopRegistry,
    eval_registry: EvalRegistry,
    req: EvalRunRequest,
) -> AsyncIterator[dict[str, Any]]:
    suite = get_suite(req.suite_id)
    wanted = req.task_ids if req.task_ids is not None else suite["default_task_ids"]
    task_ids: list[str] = [t for t in suite["task_ids"] if t in wanted]
    eval_id = uuid.uuid4().hex[:12]
    eval_registry.start(eval_id)
    yield {
        "type": "eval_start",
        "eval_id": eval_id,
        "jobs": [{"job_id": t, "task_id": t, "name": get_task(t).name} for t in task_ids],
    }

    owned: str | None = None  # a session this evaluation created and must close
    try:
        for task_id in task_ids:
            if eval_registry.should_stop(eval_id):
                yield {"type": "job_done", "job_id": task_id, "success": False, "status": "skipped", "detail": None}
                continue

            yield {"type": "job_boot", "job_id": task_id}
            last_completed: bool | None = None
            status: str = "error"
            detail: str | None = None
            try:
                if req.reuse and req.reuse.task_id == task_id and manager.get(req.reuse.session_id):
                    session_id = req.reuse.session_id
                else:
                    task = get_task(task_id)
                    session = await manager.create_session(task.task_id, resolve_config_path(task), task.runtime)
                    session_id = owned = session.session_id
                eval_registry.set_current(eval_id, session_id)
                if eval_registry.should_stop(eval_id):
                    agent_registry.request_stop(session_id)

                yield {"type": "job_start", "job_id": task_id, "session_id": session_id}
                async for ev in run_agent_loop(manager, agent_registry, session_id, req.agent):
                    if ev["type"] == "turn_done" and ev["code"] is not None:
                        last_completed = ev["task_completed"]
                    elif ev["type"] == "loop_done":
                        status, detail = ev["status"], ev["detail"]
                    yield {"type": "job_event", "job_id": task_id, "event": ev}
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - reported as this task's error
                logger.exception("eval task %s failed", task_id)
                status, detail = "error", str(exc)
            finally:
                eval_registry.set_current(eval_id, None)
                if owned is not None:
                    sid, owned = owned, None
                    # Its own task: still completes when this generator is
                    # being cancelled by a client disconnect.
                    closing = asyncio.ensure_future(manager.close_session(sid))
                    await asyncio.shield(closing)

            yield {"type": "job_done", "job_id": task_id, "success": bool(last_completed), "status": status, "detail": detail}

        yield {"type": "eval_done", "stopped": eval_registry.should_stop(eval_id)}
    finally:
        eval_registry.finish(eval_id)
