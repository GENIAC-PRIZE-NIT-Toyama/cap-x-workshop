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

`featured` just controls where a task shows up on the WebUI's task-select
screen (a small "おすすめタスク" section up top vs. everything else below) —
it has no effect on what's actually runnable. Toggle it per task as needed
for a given event.

Not every Robosuite task in env_configs/ is listed here. `two_arm_lift` in
particular needs OWL-ViT + SAM2 Perception servers
(capx/integrations/franka/two_arm_lift.py), which the current deployment
doesn't run or proxy (see workshop/docker/docker-compose.yml — only
SAM3/GraspNet/PyRoKi) — add it only after provisioning those.
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
    featured: bool = False


TASKS: list[TaskSpec] = [
    TaskSpec(
        task_id="cube_lifting",
        name="Cube Lifting",
        description=(
            "赤いキューブをSAM3で検出し、Franka Pandaで持ち上げるタスクです。"
            "物体は1つだけで、Perception→把持→持ち上げの一連の流れを体験できます。"
        ),
        config_path="env_configs/cube_lifting/franka_robosuite_cube_lifting.yaml",
        featured=True,
    ),
    TaskSpec(
        task_id="cube_restack",
        name="Cube Restack",
        description=(
            "2つのキューブの積み方を入れ替えるタスクです。"
            "現在の積み方を見て、どちらを先に動かすか自分で判断する必要があります。"
        ),
        config_path="env_configs/cube_restack/franka_robosuite_cube_restack.yaml",
        featured=True,
    ),
    TaskSpec(
        task_id="cube_stack",
        name="Cube Stack",
        description=(
            "1つ目のキューブを検出し、2つ目のキューブの上に積むタスクです。"
            "Cube Restackより工程がシンプルです。"
        ),
        config_path="env_configs/cube_stack/franka_robosuite_cube_stack.yaml",
    ),
    TaskSpec(
        task_id="nut_assembly",
        name="Nut Assembly",
        description=(
            "ナットを検出してペグに挿入するタスクです。より精密な位置合わせが必要です。"
        ),
        config_path="env_configs/nut_assembly/franka_robosuite_nut_assembly.yaml",
    ),
    TaskSpec(
        task_id="spill_wipe",
        name="Spill Wipe",
        description=(
            "こぼれたものをスポンジで拭き取るタスクです。"
            "接触を伴う動作が続くため、把持・移動系のタスクとは違った難しさがあります。"
        ),
        config_path="env_configs/spill_wipe/franka_robosuite_spill_wipe.yaml",
    ),
    TaskSpec(
        task_id="two_arm_handover",
        name="Two-Arm Handover",
        description=(
            "2本のFranka Pandaアームでハンマーを受け渡すタスクです。"
            "双腕の協調が必要な、最も難易度の高いタスクです。"
        ),
        config_path="env_configs/two_arm_handover/two_arm_handover.yaml",
    ),
]


def get_task(task_id: str) -> TaskSpec:
    for task in TASKS:
        if task.task_id == task_id:
            return task
    raise KeyError(task_id)


def resolve_config_path(task: TaskSpec) -> str:
    return str(REPO_ROOT / task.config_path)
