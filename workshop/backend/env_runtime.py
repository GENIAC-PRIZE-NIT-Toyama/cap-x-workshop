"""Owns exactly one Robosuite `CodeExecutionEnvBase` instance for the
lifetime of one WebUI session, wrapped as plain, transport-agnostic methods.

`run_cell()` is where participant-submitted Python actually executes (via
`CodeExecutionEnvBase.step(code)` -> `exec()`). This class itself does not
sandbox anything — it is meant to run **only** inside the locked-down,
network-isolated container built from `workshop/backend/docker/Dockerfile`
and served by `workshop/backend/worker_server.py`. Isolation is provided by
Docker (dropped capabilities, no privilege escalation, resource limits, and
a network with no route to anything but the Perception API — see
`workshop/backend/session_manager.py`), not by anything in this file. Never
import or instantiate this class from the backend/app.py process.
"""

from __future__ import annotations

import base64
import io
import logging
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


class EnvRuntime:
    """Stateful wrapper around one `CodeExecutionEnvBase` instance."""

    def __init__(self, config_path: str, video_dir: str) -> None:
        from capx.envs.configs.instantiate import instantiate as cfg_instantiate
        from capx.envs.configs.loader import DictLoader

        configs_dict = DictLoader.load([config_path])
        env_factory = configs_dict["env"]
        self._env = cfg_instantiate(env_factory)

        # Turn on the existing execution_logger integration (capx/integrations/base_api.py)
        # so Perception API calls (e.g. get_object_pose, sample_grasp_pose) record
        # debug images — this is what powers the optional Perception panel.
        for api in getattr(self._env, "_apis", {}).values():
            api.enable_webui(True)

        # Function reference for whatever API tier this task's config wires up
        # (name + signature + docstring, via ApiBase.combined_doc()), shown in
        # the frontend's "利用可能なAPI" docs panel.
        self.api_docs = "\n\n".join(
            api.combined_doc() for api in getattr(self._env, "_apis", {}).values()
        )

        self._video_dir = video_dir
        self._cell_counter = 0
        self._last_obs: dict[str, Any] = {}

        self._env.enable_video_capture(True, clear=True)

    def reset(self) -> dict[str, Any]:
        obs, info = self._env.reset()
        # Clear the recorded frame buffer on every reset — otherwise a "save
        # replay" after a mid-task reset mixes frames from the abandoned
        # attempt with the new one.
        self._env.enable_video_capture(True, clear=True)
        self._last_obs = obs
        self._cell_counter = 0
        return {
            "frames": _extract_frames(self._env, obs),
            "task_prompt": info.get("task_prompt"),
            "api_docs": self.api_docs,
        }

    def run_cell(self, cell_id: str, code: str) -> dict[str, Any]:
        from capx.utils import execution_logger

        self._cell_counter += 1
        execution_logger.init_execution_context(code_block_index=self._cell_counter)
        try:
            obs, reward, terminated, truncated, info = self._env.step(code)
        finally:
            history = execution_logger.finalize_execution_context()
        self._last_obs = obs
        perception_steps = history.to_dict()["steps"] if history else []
        return {
            "cell_id": cell_id,
            "frames": _extract_frames(self._env, obs),
            "stdout": info.get("stdout", ""),
            "stderr": info.get("stderr", ""),
            "ok": info.get("sandbox_rc", 1) == 0,
            "reward": float(reward),
            "terminated": bool(terminated),
            "truncated": bool(truncated),
            # Low-level task_completed() implementations (e.g. robosuite's
            # _check_success()) commonly return numpy.bool_, not a native
            # bool. FastAPI/JSON can't serialize that, so normalize here.
            "task_completed": (
                None if info.get("task_completed") is None else bool(info["task_completed"])
            ),
            "perception_steps": perception_steps,
        }

    def observation(self) -> dict[str, Any]:
        return {"frames": _extract_frames(self._env, self._last_obs)}

    def recorded_frame_count(self) -> int:
        """Number of frames captured into the video buffer so far.

        This grows *during* run_cell() (robosuite's internal simulate loop
        appends to it on every sub-sampled sim step — see
        RobosuiteBaseEnv._record_frame()), not just after it returns. Used by
        worker_server.py's /stream websocket to detect and push new frames
        while a cell — e.g. a goto_pose() spanning hundreds of sim steps — is
        still executing, so participants see the robot actually move instead
        of only a before/after snapshot.
        """
        return self._env.get_video_frame_count()

    def recorded_frame(self, index: int) -> np.ndarray | None:
        frames = self._env.get_video_frames_range(index, index + 1)
        return frames[0] if frames else None

    def primary_camera_name(self) -> str:
        """Which `frames` key the video buffer's recorded frames correspond
        to — this varies per task (e.g. "robot0_robotview" for the single-arm
        tasks, "birdview" for nut_assembly, "agentview" for the two-arm
        tasks; see each simulator's `save_camera_name` in
        capx/envs/simulators/*.py), so it must never be hardcoded on the
        frontend.
        """
        return getattr(self._env.low_level_env, "save_camera_name", "robot0_robotview")

    def replay(self, suffix: str = "combined") -> dict[str, Any]:
        from capx.utils.video_utils import _write_video

        frames = self._env.get_video_frames(clear=False)
        if not frames:
            return {"path": None}
        Path(self._video_dir).mkdir(parents=True, exist_ok=True)
        _write_video(frames, self._video_dir, suffix=suffix)
        return {"path": str(Path(self._video_dir) / f"video_{suffix}.mp4")}
