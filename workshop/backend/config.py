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
    # Japanese rendering of the task's English prompt (the `PROMPT` constant
    # of the capx task class the config_path points at). Hand-translated and
    # not synced automatically — update it when the capx prompt changes. The
    # WebUI shows this by default and lets participants switch to the
    # English original; None hides the switch.
    prompt_ja: str | None = None


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
        prompt_ja=(
            "あなたは以下のAPIでFranka Emikaロボットを制御します。\n"
            "目標: 赤いキューブを掴んで持ち上げてください。\n"
            "思考のためにPythonのコードコメントを書いても構いませんが、実行可能なPythonコードのみを書き、コードフェンスで囲まないでください。\n"
            "以下の関数（API）は環境にすでにimportされています。numpyを使う場合は明示的にimportしてください。"
        ),
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
        prompt_ja=(
            "あなたは以下のAPIでFranka Emikaロボットを制御します。\n"
            "目標: 赤いキューブを緑のキューブの上にそっと置き、その後グリッパーを開いてください。高い位置から落としてはいけません。\n"
            "キューブの寸法（extent）を使って、置くべき正確な高さを計算してください。\n"
            "思考のためにPythonのコードコメントを書いても構いませんが、実行可能なPythonコードのみを書き、コードフェンスで囲まないでください。\n"
            "以下の関数（API）は環境にすでにimportされています。numpy、scipy、torchなどを使う場合は明示的にimportしてください。"
        ),
    ),
    TaskSpec(
        task_id="cube_stack",
        name="Cube Stack",
        description=(
            "1つ目のキューブを検出し、2つ目のキューブの上に積むタスクです。"
            "Cube Restackより工程がシンプルです。"
        ),
        config_path="env_configs/cube_stack/franka_robosuite_cube_stack.yaml",
        featured=True,
        prompt_ja=(
            "あなたは以下のAPIでFranka Emikaロボットを制御します。\n"
            "目標: 赤いキューブを掴み、緑のキューブの上にそっと積んでから離してください。\n"
            "\n"
            "重要なルール:\n"
            "- get_object_pose(..., return_bbox_extent=True) が返す extent は辺の「全長」です。半分の高さには extent[2]/2 を使ってください。\n"
            "- 置くときの姿勢には sample_grasp_pose が返した把持クォータニオンを使い回してください。get_object_pose のクォータニオンは姿勢の情報として信頼できないので使わないでください。\n"
            "- 物体を掴む・置くために近づくときは、必ず z_approach=0.1 を指定してください。\n"
            "- 掴んだ後は、横方向に移動する前にキューブを安全な高さ（Z方向に少なくとも +0.2m）まで持ち上げてください。\n"
            "- 積む高さの式: place_z = green_center_z + green_extent[2]/2 + red_extent[2]/2\n"
            "- 高い位置から落としてはいけません。制御された降下のために必ず z_approach を使って近づいてください。\n"
            "\n"
            "実行可能なPythonコードのみを書いてください（コードフェンスは不要）。必要ならnumpyをimportしてください。"
        ),
    ),
    TaskSpec(
        task_id="nut_assembly",
        name="Nut Assembly",
        description=(
            "ナットを検出してペグに挿入するタスクです。より精密な位置合わせが必要です。"
        ),
        config_path="env_configs/nut_assembly/franka_robosuite_nut_assembly.yaml",
        prompt_ja=(
            "あなたは以下のAPIでFranka Emikaロボットを制御します。\n"
            "目標: `brown square nut` を掴み、`brown square block` に挿入してください。\n"
            "ナットは取っ手（handle）の部分を掴みます。取っ手をうまく掴むには、言語クエリ `extruded handle of the brown square nut` を試してください。\n"
            "brown square nut と、その extruded handle は同じ剛体の一部です。\n"
            "'extruded handle of the brown square nut' に対する把持姿勢クエリは、取っ手の領域にあるエンドエフェクタ姿勢をワールド座標系で返します。\n"
            "'white hollow center of the brown square nut' で得られるナット中心の姿勢と、'extruded handle of the brown square nut' で得られる取っ手の把持姿勢の間には固定の剛体変換があり、ナットをペグに挿入するときはこれを正しく適用する必要があります。\n"
            "思考のためにPythonのコードコメントを書いても構いませんが、実行可能なPythonコードのみを書き、コードフェンスで囲まないでください。\n"
            "以下の関数（API）は環境にすでにimportされています。\n"
            "numpyや、空間変換のためのscipyを使う場合は明示的にimportしてください。"
        ),
    ),
    TaskSpec(
        task_id="spill_wipe",
        name="Spill Wipe",
        description=(
            "こぼれたものをスポンジで拭き取るタスクです。"
            "接触を伴う動作が続くため、把持・移動系のタスクとは違った難しさがあります。"
        ),
        config_path="env_configs/spill_wipe/franka_robosuite_spill_wipe.yaml",
        prompt_ja=(
            "あなたは以下のAPIでFranka Emikaロボットを制御します。\n"
            "目標: 'brown spill'（茶色いこぼれ跡）を拭き取ってください。\n"
            "グリッパー（エンドエフェクタ）にはすでにスポンジが取り付けられています。\n"
            "テーブル面の高さはちょうど z = 0.0 m で、拭き取りはこの高さで行ってください（追加のオフセットは不要です）。\n"
            "こぼれ跡の寸法（extent）を使って、拭き取り動作の x・y の最小/最大範囲を決めてください。\n"
            "逆運動学の解の差が大きいと最適な軌道にならない場合があるため、大きな拭き取り動作は避けてください。\n"
            "スポンジはすでにエンドエフェクタに付いているので、拭き取りには下向きの姿勢（wxyz で 0,0,1,0）を使ってください。\n"
            "思考のためにPythonのコードコメントを書いても構いませんが、実行可能なPythonコードのみを書き、コードフェンスで囲まないでください。\n"
            "以下の関数（API）は環境にすでにimportされています。numpyを使う場合は明示的にimportしてください。"
        ),
    ),
    TaskSpec(
        task_id="two_arm_handover",
        name="Two-Arm Handover",
        description=(
            "2本のFranka Pandaアームでハンマーを受け渡すタスクです。"
            "双腕の協調が必要な、最も難易度の高いタスクです。"
        ),
        config_path="env_configs/two_arm_handover/two_arm_handover.yaml",
        prompt_ja=(
            "あなたは以下のAPIで、2本のアームからなるFranka Emikaロボットシステムを制御します。\n"
            "目標: アーム0がハンマーを掴んで持ち上げ、アーム1に手渡します。アーム1はハンマーの柄（ヘッドではなく）を掴みます。受け渡しの間、ハンマーのz値が0.15〜0.20の範囲にあれば成功とみなされます。\n"
            "\n"
            "座標系:\n"
            "- すべての姿勢関数は、robot0 のベース座標系で位置を受け取ります（get_object_pose / goto_pose_arm* が返す・受け取る座標系と同じです）。\n"
            "- テーブル面は必ずしも z=0 ではありません。\n"
            "- 座標軸の規約:\n"
            "  - Z軸: 上が正、下が負\n"
            "  - X軸: 右が正、左が負\n"
            "  - Y軸: 前が正、後ろが負\n"
            "\n"
            "環境の詳細:\n"
            "- アーム0（左）とアーム1（右）はテーブルを挟んで反対側に配置されています。\n"
            "- ハンマーの柄の長さは 0.15m〜0.25m の範囲でランダムです。\n"
            "- ハンマーは最初、テーブルの上にY軸に沿って平置きされており、柄が +Y 側、ヘッドが -Y 側を向いています。\n"
            "\n"
            "重要な情報:\n"
            "- 受け渡しは、両グリッパーの初期位置の中間点付近で行う必要があります。アーム1へ衝突なく渡せる最適なハンマーの向きを考えてください。\n"
            "- テーブルは2本のアームの間の領域全体には広がっていません。ハンマーが中央の隙間に落ちると床まで落下し、タスクは復旧不能になります。\n"
            "- 衝突を避けてください。動きを回転成分と並進成分に分解し、段階的に動かす必要があります。衝突を安全に避けられる最適なウェイポイントの順序を考えてください。\n"
            "- アームのリンクには体積があり、中間の動きは衝突チェックされません。グリッパー間には最低 8cm の余裕を保ってください。\n"
            "\n"
            "参考クォータニオン:\n"
            "- アーム0 グリッパー下向き・X軸方向に開く: [0, 0.707, 0.707, 0]\n"
            "- アーム0 グリッパー下向き・Y軸方向に開く: [0, 1, 0, 0]\n"
            "- アーム1 グリッパー下向き・Y軸方向に開く: [0, 0, 1, 0]\n"
            "\n"
            "各アームのグリッパーのおおよその初期位置（robot0 座標系）。試行ごとに数cm程度ずれることがあります:\n"
            "- アーム0: x = 0.44, y = 0.0\n"
            "- アーム1: x = 1.18, y = 0.0\n"
            "\n"
            "思考のためにPythonのコードコメントを書いても構いませんが、実行可能なPythonコードのみを書き、コードフェンスで囲まないでください。\n"
            "以下の関数（API）は環境にすでにimportされています。numpyを使う場合は明示的にimportしてください。"
        ),
    ),
]


def get_task(task_id: str) -> TaskSpec:
    for task in TASKS:
        if task.task_id == task_id:
            return task
    raise KeyError(task_id)


def resolve_config_path(task: TaskSpec) -> str:
    return str(REPO_ROOT / task.config_path)
