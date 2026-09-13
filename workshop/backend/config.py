"""Task registry for the workshop WebUI.

See WORKSHOP_WEBUI_SPEC.md section 1.1: the WebUI does not hard-code a single
task. Instead it renders whatever is listed here, so the organizer can decide
later which Robosuite task(s) to actually use on the day, by editing this
list, without touching the frontend or the session/worker plumbing.

All tasks share the same Perception API tier (visual) via the plain,
non-suffixed config variants — e.g. `get_object_pose`, `sample_grasp_pose`,
`goto_pose`, `open_gripper`/`close_gripper`. Switched from the reduced tier
(WORKSHOP_WEBUI_SPEC.md section 1.2's original recommendation) for the
workshop demo so participants call fewer, higher-level functions instead of
composing segmentation + grasp planning + IK themselves.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class TaskSpec:
    task_id: str
    name: str
    description: str
    config_path: str  # relative to REPO_ROOT


TASKS: list[TaskSpec] = [
    TaskSpec(
        task_id="cube_lifting",
        name="Cube Lifting",
        description=(
            "赤いキューブをSAM3で検出し、Franka Pandaで持ち上げるタスクです。"
            "物体は1つだけで、Perception→把持→持ち上げの一連の流れを体験できます。"
        ),
        config_path="env_configs/cube_lifting/franka_robosuite_cube_lifting.yaml",
    ),
    TaskSpec(
        task_id="cube_restack",
        name="Cube Restack",
        description=(
            "2つのキューブの積み方を入れ替えるタスクです。"
            "現在の積み方を見て、どちらを先に動かすか自分で判断する必要があります。"
        ),
        config_path="env_configs/cube_restack/franka_robosuite_cube_restack.yaml",
    ),
    TaskSpec(
        task_id="nut_assembly",
        name="Nut Assembly",
        description=(
            "ナットを検出してペグに挿入するタスクです。より精密な位置合わせが必要です。"
        ),
        config_path="env_configs/nut_assembly/franka_robosuite_nut_assembly.yaml",
    ),
]


def get_task(task_id: str) -> TaskSpec:
    for task in TASKS:
        if task.task_id == task_id:
            return task
    raise KeyError(task_id)


def resolve_config_path(task: TaskSpec) -> str:
    return str(REPO_ROOT / task.config_path)
