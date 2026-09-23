"""Agent Mode's LLM -> code-execution loop (see WORKSHOP_AGENT_PLAN.md).

Unlike "prompt" mode's `/experiments/generate` (app.py), which is a pure,
stateless LLM proxy that the frontend drives one turn at a time, this module
owns the *whole* multi-turn loop server-side: render the System/Feedback
Prompt templates, call the LLM, extract the model's last code block, run it
in the session's sandbox container, render the next Feedback Prompt from
that turn's stdout/stderr, and repeat — streaming each step out as an event
so the frontend can render a live trajectory view without driving any of the
turn-by-turn control flow itself.

Deliberately session-scoped and side-effect-free beyond the one session it's
given: `run_agent_loop()` reads/writes nothing outside `manager` + the one
`session_id` it's called with (plus its own entry in `_stop_flags`, also
keyed by that same session_id). That's what lets Phase 3 (multiple tasks at
once — see WORKSHOP_AGENT_ENV.md) run N of these concurrently later with no
changes here: just N calls to `run_agent_loop()`, one per session, e.g. via
`asyncio.gather`.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import AsyncIterator
from typing import Any, Literal

from pydantic import BaseModel

from workshop.backend.code_extract import extract_last_code_block
from workshop.backend.llm_client import stream_chat_completion
from workshop.backend.prompt_render import PromptRenderError, render_template
from workshop.backend.session_manager import SessionManager

logger = logging.getLogger(__name__)

TerminationMode = Literal["simulation", "agent"]

# Loop-ending statuses an `AgentEvent(type="loop_done")` can carry.
LoopStatus = Literal[
    "task_completed",  # termination_mode="simulation" and the sim reported task_completed=True
    "agent_finished",  # the model's last turn had no fenced code block at all
    "max_turns",  # hit `max_turns` without either of the above
    "stopped",  # a stop request (POST .../agent/stop) was seen between/mid turn
    "error",  # template render error, LLM error, or sandbox execution error
]


class AgentRunRequest(BaseModel):
    system_prompt: str
    feedback_prompt: str
    vision_enabled: bool = False
    termination_mode: TerminationMode = "agent"
    max_turns: int = 10
    settings: dict[str, float] = {}


def _to_content(text: str, frames: dict[str, str], vision_enabled: bool) -> str | list[dict[str, Any]]:
    """Builds one message's `content`. Plain string when vision is off or
    there's no frame to attach (every caller before Agent Mode used a plain
    string, and vLLM/OpenAI both accept that as shorthand for a single text
    part); otherwise the OpenAI multipart form the vLLM-served model's
    chat template expects: one text part plus one image part.

    `frames` values are raw base64 (no `data:` prefix — see
    `env_runtime._encode_rgb_jpeg`, the same convention the `/stream`
    websocket and `CameraView` already rely on), so the prefix is added
    here rather than changing that shared contract.
    """
    if not vision_enabled or not frames:
        return text
    camera = next(iter(frames))
    data_url = f"data:image/jpeg;base64,{frames[camera]}"
    return [
        {"type": "text", "text": text},
        {"type": "image_url", "image_url": {"url": data_url}},
    ]


class AgentLoopRegistry:
    """Tracks which sessions have a stop request pending. One instance lives
    on `app.state` (see app.py), shared by the `/agent/run` SSE handler
    (which loops on it) and `/agent/stop` (which sets it). A plain `set`
    keyed by session_id is enough: this is a single-process backend, so no
    cross-process coordination is needed, and a session can only ever have
    one agent loop running at a time (the frontend disables Start while one
    is in flight)."""

    def __init__(self) -> None:
        self._stop_requested: set[str] = set()

    def request_stop(self, session_id: str) -> None:
        self._stop_requested.add(session_id)

    def should_stop(self, session_id: str) -> bool:
        return session_id in self._stop_requested

    def clear(self, session_id: str) -> None:
        self._stop_requested.discard(session_id)


async def run_agent_loop(
    manager: SessionManager,
    registry: AgentLoopRegistry,
    session_id: str,
    req: AgentRunRequest,
) -> AsyncIterator[dict[str, Any]]:
    """Runs the Agent Loop for one session, yielding one event dict per
    step. Event shapes (all carry `"type"`):

    - `{"type": "turn_start", "turn": int}`
    - `{"type": "llm_delta", "turn": int, "text": str}` (streamed as the
      model generates; concatenate to reconstruct that turn's full response)
    - `{"type": "turn_done", "turn": int, "llm_raw": str, "code": str,
       "stdout": str, "stderr": str, "frames": dict[str, str] | None,
       "task_completed": bool | None}`
    - `{"type": "loop_done", "status": LoopStatus, "turn": int, "detail": str | None}`

    `loop_done` is always the last event; the generator returns immediately
    after yielding it. Errors (bad template, LLM/sandbox failure) surface as
    a `loop_done` with `status="error"` and a human-readable `detail`,
    rather than raising — SSE has no good way to carry a mid-stream
    exception separately from "the stream ended", so this keeps app.py's
    `/agent/run` handler from needing its own parallel error-shape.

    Deliberately does *not* clear `registry`'s stop flag for `session_id` on
    entry (only in the `finally` block at the end): a stop request that
    happens to already be pending the instant this generator starts (e.g. a
    participant double-clicking Start then Stop) should still be honored —
    see the `should_stop()` check right below — not silently discarded.
    """
    try:
        reset_result = await manager.reset(session_id)
    except Exception as exc:
        logger.exception("agent loop: reset failed for session %s", session_id)
        yield {"type": "loop_done", "status": "error", "turn": 0, "detail": f"環境リセットに失敗しました: {exc}"}
        return

    variables: dict[str, Any] = {
        "api_document": reset_result.get("api_docs", ""),
        "task_instruction": reset_result.get("task_prompt") or "",
    }

    try:
        system_text = render_template(req.system_prompt, variables)
    except PromptRenderError as exc:
        yield {"type": "loop_done", "status": "error", "turn": 0, "detail": f"System Promptの描画に失敗しました: {exc}"}
        return

    messages: list[dict[str, Any]] = [
        {"role": "user", "content": _to_content(system_text, reset_result.get("frames", {}), req.vision_enabled)}
    ]

    turn = 0
    try:
        for turn in range(1, req.max_turns + 1):
            if registry.should_stop(session_id):
                yield {"type": "loop_done", "status": "stopped", "turn": turn - 1, "detail": None}
                return

            yield {"type": "turn_start", "turn": turn}

            full_text = ""
            try:
                # stream_chat_completion() is a plain (sync) generator over
                # a blocking HTTP stream — run it in a thread and rendezvous
                # each delta back onto this coroutine via a queue, the same
                # pattern app.py's /experiments/generate uses, so this loop
                # keeps yielding turn-by-turn SSE events instead of blocking
                # the event loop for the whole LLM call.
                loop = asyncio.get_event_loop()
                queue: asyncio.Queue[tuple[str, str] | None] = asyncio.Queue()

                def _produce(msgs: list[dict[str, Any]] = messages) -> None:
                    try:
                        for delta in stream_chat_completion(msgs, req.settings):
                            loop.call_soon_threadsafe(queue.put_nowait, ("delta", delta))
                    except Exception as exc:  # noqa: BLE001 - surfaced to the SSE stream as an error event
                        loop.call_soon_threadsafe(queue.put_nowait, ("error", str(exc)))
                    finally:
                        loop.call_soon_threadsafe(queue.put_nowait, None)

                threading.Thread(target=_produce, daemon=True).start()

                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    kind, text = item
                    if kind == "error":
                        raise RuntimeError(text)
                    full_text += text
                    yield {"type": "llm_delta", "turn": turn, "text": text}
            except Exception as exc:
                yield {
                    "type": "loop_done",
                    "status": "error",
                    "turn": turn,
                    "detail": f"LLM呼び出しに失敗しました: {exc}",
                }
                return

            messages.append({"role": "assistant", "content": full_text})
            code = extract_last_code_block(full_text)

            if code is None:
                # The model chose not to act — this *is* "the agent decides
                # it's done" (see WORKSHOP_AGENT_PLAN.md §1.3), independent
                # of termination_mode.
                yield {"type": "loop_done", "status": "agent_finished", "turn": turn, "detail": None}
                return

            try:
                result = await manager.run_cell(session_id, f"agent-turn-{turn}", code)
            except Exception as exc:
                yield {
                    "type": "loop_done",
                    "status": "error",
                    "turn": turn,
                    "detail": f"コード実行に失敗しました: {exc}",
                }
                return

            task_completed = result.get("task_completed")
            feedback_vars = {
                **variables,
                "stdout": result.get("stdout", ""),
                "stderr": result.get("stderr", ""),
                "turn": turn,
                "max_turns": req.max_turns,
                "is_task_completed": task_completed,
            }
            try:
                feedback_text = render_template(req.feedback_prompt, feedback_vars)
            except PromptRenderError as exc:
                yield {
                    "type": "loop_done",
                    "status": "error",
                    "turn": turn,
                    "detail": f"Feedback Promptの描画に失敗しました: {exc}",
                }
                return

            frames = result.get("frames", {})
            messages.append({"role": "user", "content": _to_content(feedback_text, frames, req.vision_enabled)})

            yield {
                "type": "turn_done",
                "turn": turn,
                "llm_raw": full_text,
                "code": code,
                "stdout": result.get("stdout", ""),
                "stderr": result.get("stderr", ""),
                "frames": frames if req.vision_enabled else None,
                "task_completed": task_completed,
            }

            if req.termination_mode == "simulation" and task_completed:
                yield {"type": "loop_done", "status": "task_completed", "turn": turn, "detail": None}
                return

            if registry.should_stop(session_id):
                yield {"type": "loop_done", "status": "stopped", "turn": turn, "detail": None}
                return

        yield {"type": "loop_done", "status": "max_turns", "turn": req.max_turns, "detail": None}
    finally:
        registry.clear(session_id)
