"""Task registry for the workshop WebUI.

See WORKSHOP_WEBUI_SPEC.md section 1.1: the WebUI does not hard-code a single
task. Instead it renders whatever is listed here, so the organizer can decide
later which Robosuite task(s) to actually use on the day, by editing this
list, without touching the frontend or the session/worker plumbing.

All tasks share the same Perception API tier (reduced) via the
`*_reduced_api.yaml` config variants, per WORKSHOP_WEBUI_SPEC.md section 1.2 —
the set of functions available to participants' code does not change from
task to task, only the scene/objects do.
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
        config_path="env_configs/cube_lifting/franka_robosuite_cube_lifting_reduced_api.yaml",
    ),
    TaskSpec(
        task_id="cube_restack",
        name="Cube Restack",
        description=(
            "2つのキューブの積み方を入れ替えるタスクです。"
            "現在の積み方を見て、どちらを先に動かすか自分で判断する必要があります。"
        ),
        config_path="env_configs/cube_restack/franka_robosuite_cube_restack_reduced_api.yaml",
    ),
    TaskSpec(
        task_id="nut_assembly",
        name="Nut Assembly",
        description=(
            "ナットを検出してペグに挿入するタスクです。より精密な位置合わせが必要です。"
        ),
        config_path="env_configs/nut_assembly/franka_robosuite_nut_assembly_reduced_api.yaml",
    ),
]


def get_task(task_id: str) -> TaskSpec:
    for task in TASKS:
        if task.task_id == task_id:
            return task
    raise KeyError(task_id)


def resolve_config_path(task: TaskSpec) -> str:
    return str(REPO_ROOT / task.config_path)
