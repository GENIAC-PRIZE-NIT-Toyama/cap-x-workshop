"""Child-process entry point that owns one Robosuite session.

Design (see WORKSHOP_WEBUI_SPEC.md section 3.3): one WebUI session = one OS
process, started with the ``spawn`` multiprocessing context (matching
``capx/utils/parallel_eval.py``'s rationale: MuJoCo/EGL contexts are not
thread-safe and must not be shared across CUDA-using processes started via
``fork``). This process holds a single ``CodeExecutionEnvBase`` instance for
its entire lifetime and talks to the FastAPI backend over two
``multiprocessing.Queue``s using a tiny request/response protocol — no new RPC
framework is introduced, since everything happens on one machine.

Each "run a code cell" command maps 1:1 onto a single ``env.step(code)`` call;
``CodeExecutionEnvBase`` already keeps a persistent globals dict across calls
(WORKSHOP_WEBUI_SPEC.md section 1.3), so this file does not need to implement
any notebook/session state itself.
"""

from __future__ import annotations

import base64
import io
import logging
import queue
import traceback
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)


def _encode_rgb_png(rgb: np.ndarray) -> str:
    """Encode an (H, W, 3) uint8 RGB array as a base64 PNG string."""
    image = Image.fromarray(np.ascontiguousarray(rgb).astype("uint8"))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _extract_frames(exec_env: Any, obs: dict[str, Any]) -> dict[str, str]:
    """Pull whatever camera RGB images are present in `obs` plus the wrist view.

    Camera keys come from the low-level env's `render_camera_names`
    (capx/envs/simulators/robosuite_base.py), so this works unchanged for any
    Robosuite task registered in the task registry (config.py) without this
    file needing to know which task is running.
    """
    frames: dict[str, str] = {}
    low_level = getattr(exec_env, "low_level_env", None)
    for camera_name in getattr(low_level, "render_camera_names", []):
        cam_obs = obs.get(camera_name)
        if isinstance(cam_obs, dict):
            rgb = cam_obs.get("images", {}).get("rgb")
            if rgb is not None:
                frames[camera_name] = _encode_rgb_png(rgb)
    try:
        wrist = exec_env.render_wrist()
        if wrist is not None:
            frames["wrist"] = _encode_rgb_png(wrist)
    except Exception:
        # Don't let a wrist-camera hiccup break the whole frame response, but
        # do log it — silently dropping this made "the wrist view never
        # shows up" reports impossible to diagnose during the workshop.
        logger.warning("render_wrist() failed", exc_info=True)
    return frames


def worker_main(config_path: str, video_dir: str, cmd_q: "queue.Queue[dict]", result_q: "queue.Queue[dict]") -> None:
    """Runs forever in a dedicated process until it receives a "shutdown" command.

    Protocol (all messages are plain dicts, see session_manager.py for the
    parent side):
      -> {"type": "reset"}
      <- {"type": "reset_ok", "frames": {...}, "task_prompt": str | None}
      -> {"type": "run_cell", "cell_id": str, "code": str}
      <- {"type": "run_cell_ok", "cell_id": str, "frames": {...}, "stdout": str,
          "stderr": str, "ok": bool, "reward": float, "terminated": bool,
          "truncated": bool, "task_completed": bool | None,
          "perception_steps": [...]}
      -> {"type": "observation"}
      <- {"type": "observation_ok", "frames": {...}}
      -> {"type": "replay", "suffix": str}
      <- {"type": "replay_ok", "path": str | None}
      -> {"type": "shutdown"}  (no reply, process exits)
    Any handler exception is reported back as {"type": "error", ...} instead
    of crashing the worker, since one broken cell shouldn't kill the session.
    """
    try:
        from capx.envs.configs.instantiate import instantiate as cfg_instantiate
        from capx.envs.configs.loader import DictLoader
        from capx.utils import execution_logger
        from capx.utils.video_utils import _write_video

        configs_dict = DictLoader.load([config_path])
        env_factory = configs_dict["env"]
        env = cfg_instantiate(env_factory)

        # Turn on the existing execution_logger integration (capx/integrations/base_api.py)
        # so Perception API calls (e.g. segment_sam3_text_prompt) record debug images —
        # this is what powers the optional Perception panel (WORKSHOP_WEBUI_SPEC.md section 1.4).
        for api in getattr(env, "_apis", {}).values():
            api.enable_webui(True)

        env.enable_video_capture(True, clear=True)

        cell_counter = 0
        last_obs: dict[str, Any] = {}

        result_q.put({"type": "ready"})
    except Exception as exc:  # startup failure: bad config, missing GPU, import error, ...
        result_q.put({"type": "fatal", "error": repr(exc), "traceback": traceback.format_exc()})
        return

    while True:
        try:
            cmd = cmd_q.get(timeout=3600)
        except queue.Empty:
            continue

        cmd_type = cmd.get("type")
        if cmd_type == "shutdown":
            break

        request_id = cmd.get("request_id")
        try:
            if cmd_type == "reset":
                obs, info = env.reset()
                # Clear the recorded frame buffer on every reset — otherwise
                # a "save replay" after a mid-task reset mixes frames from
                # the abandoned attempt with the new one.
                env.enable_video_capture(True, clear=True)
                last_obs = obs
                cell_counter = 0
                result_q.put(
                    {
                        "type": "reset_ok",
                        "request_id": request_id,
                        "frames": _extract_frames(env, obs),
                        "task_prompt": info.get("task_prompt"),
                    }
                )

            elif cmd_type == "run_cell":
                cell_counter += 1
                execution_logger.init_execution_context(code_block_index=cell_counter)
                try:
                    obs, reward, terminated, truncated, info = env.step(cmd["code"])
                finally:
                    history = execution_logger.finalize_execution_context()
                last_obs = obs
                perception_steps = history.to_dict()["steps"] if history else []
                result_q.put(
                    {
                        "type": "run_cell_ok",
                        "request_id": request_id,
                        "cell_id": cmd.get("cell_id"),
                        "frames": _extract_frames(env, obs),
                        "stdout": info.get("stdout", ""),
                        "stderr": info.get("stderr", ""),
                        "ok": info.get("sandbox_rc", 1) == 0,
                        "reward": float(reward),
                        "terminated": bool(terminated),
                        "truncated": bool(truncated),
                        # Low-level task_completed() implementations (e.g.
                        # robosuite's _check_success()) commonly return
                        # numpy.bool_, not a native bool. Pydantic/FastAPI
                        # can't serialize that, so normalize it here rather
                        # than at the HTTP boundary.
                        "task_completed": (
                            None if info.get("task_completed") is None else bool(info["task_completed"])
                        ),
                        "perception_steps": perception_steps,
                    }
                )

            elif cmd_type == "observation":
                result_q.put(
                    {
                        "type": "observation_ok",
                        "request_id": request_id,
                        "frames": _extract_frames(env, last_obs),
                    }
                )

            elif cmd_type == "replay":
                frames = env.get_video_frames(clear=False)
                if not frames:
                    result_q.put({"type": "replay_ok", "request_id": request_id, "path": None})
                else:
                    Path(video_dir).mkdir(parents=True, exist_ok=True)
                    suffix = cmd.get("suffix", "combined")
                    _write_video(frames, video_dir, suffix=suffix)
                    result_q.put(
                        {
                            "type": "replay_ok",
                            "request_id": request_id,
                            "path": str(Path(video_dir) / f"video_{suffix}.mp4"),
                        }
                    )

            else:
                result_q.put({"type": "error", "request_id": request_id, "error": f"unknown command {cmd_type!r}"})

        except Exception as exc:  # noqa: BLE001 - report to parent, keep the worker alive
            result_q.put(
                {
                    "type": "error",
                    "request_id": request_id,
                    "cell_id": cmd.get("cell_id"),
                    "error": repr(exc),
                    "traceback": traceback.format_exc(),
                }
            )
