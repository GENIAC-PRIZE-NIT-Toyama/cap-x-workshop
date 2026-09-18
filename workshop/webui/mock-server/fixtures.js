// Fixture data for the mock backend. Hand-copied from workshop/backend/config.py
// (TASKS) and the PROMPT constants in capx/envs/tasks/franka/*.py — not
// synced automatically, see WORKSHOP_WEBUI_LOCAL_DEV.md section 4.2 / 6.

const MOCK = "[MOCK] ";

export const TASKS = [
  {
    task_id: "cube_lifting",
    name: MOCK + "Cube Lifting",
    description:
      MOCK +
      "赤いキューブをSAM3で検出し、Franka Pandaで持ち上げるタスクです。" +
      "物体は1つだけで、Perception→把持→持ち上げの一連の流れを体験できます。",
    featured: true,
  },
  {
    task_id: "cube_restack",
    name: MOCK + "Cube Restack",
    description:
      MOCK +
      "2つのキューブの積み方を入れ替えるタスクです。" +
      "現在の積み方を見て、どちらを先に動かすか自分で判断する必要があります。",
    featured: true,
  },
  {
    task_id: "cube_stack",
    name: MOCK + "Cube Stack",
    description:
      MOCK + "1つ目のキューブを検出し、2つ目のキューブの上に積むタスクです。" + "Cube Restackより工程がシンプルです。",
    featured: true,
  },
  {
    task_id: "nut_assembly",
    name: MOCK + "Nut Assembly",
    description: MOCK + "ナットを検出してペグに挿入するタスクです。より精密な位置合わせが必要です。",
    featured: false,
  },
  {
    task_id: "spill_wipe",
    name: MOCK + "Spill Wipe",
    description:
      MOCK +
      "こぼれたものをスポンジで拭き取るタスクです。" +
      "接触を伴う動作が続くため、把持・移動系のタスクとは違った難しさがあります。",
    featured: false,
  },
  {
    task_id: "two_arm_handover",
    name: MOCK + "Two-Arm Handover",
    description:
      MOCK + "2本のFranka Pandaアームでハンマーを受け渡すタスクです。" + "双腕の協調が必要な、最も難易度の高いタスクです。",
    featured: false,
  },
];

// The camera the real worker streams and keys `frames` by — each simulator's
// `save_camera_name` (capx/envs/simulators/robosuite_base.py:53 default,
// overridden in robosuite_nut_assembly.py:54 and robosuite_handover.py:47).
export const PRIMARY_CAMERA = {
  cube_lifting: "robot0_robotview",
  cube_restack: "robot0_robotview",
  cube_stack: "robot0_robotview",
  nut_assembly: "birdview",
  spill_wipe: "robot0_robotview",
  two_arm_handover: "agentview",
};

// Verbatim English prompts from capx (the strings the JA/EN toggle will
// later operate on), prefixed so they are recognisable as mock data.
export const TASK_PROMPTS = {
  cube_lifting:
    MOCK +
    `
You are controlling a Franka Emika robot with API described below.
Goal: pick up the red cube and lift it.
You may write python code comments for reasoning but ONLY write the executable Python code and do not write it in code fences.
The functions (APIs) below are already imported to the environment. If you want to use numpy, you need to import it explicitly.
`,
  cube_restack:
    MOCK +
    `
You are controlling a Franka Emika robot with API described below.
Goal: Gently place the red cube on top of the green cube and then open the gripper. Nothing should be dropped from a height.
Use the extent of the cubes to calculate the exact height for placement.
You may write python code comments for reasoning but ONLY write the executable Python code and do not write it in code fences.
The functions (APIs) below are already imported to the environment. If you want to use numpy, scipy, torch, etc. you need to import them explicitly.
`,
  cube_stack:
    MOCK +
    `
You are controlling a Franka Emika robot with the API described below.
Goal: Pick up the red cube and gently stack it on top of the green cube, then release it.

Key rules:
- The extent from get_object_pose(..., return_bbox_extent=True) is the FULL side length. Use extent[2]/2 for half-height.
- For placement orientation, reuse the grasp quaternion from sample_grasp_pose. Do NOT use the quaternion from get_object_pose (it is unreliable for orientation).
- Always use z_approach=0.1 when approaching an object for grasping or placing.
- After grasping, lift the cube to a safe height (at least +0.2m in Z) before moving laterally to the placement location.
- The stacking height formula is: place_z = green_center_z + green_extent[2]/2 + red_extent[2]/2
- Nothing should be dropped from a height. Always approach with z_approach for controlled descent.

Write ONLY executable Python code (no code fences). Import numpy if needed.
`,
  nut_assembly:
    MOCK +
    `
You are controlling a Franka Emika robot with API described below.
Goal: grasp and insert the \`brown square nut\` onto the \`brown square block\`.
Note that you would grasp the nut by its handle. You can try language query \`extruded handle of the brown square nut\` to get a good grasp at the handle.
The brown square nut and the extruded handle of the brown square nut are part of the same rigid body.
The grasp pose query for 'extruded handle of the brown square nut' returns an end-effector pose expressed in world frame, located on the handle region.
The nut's object center pose obtained via 'white hollow center of the brown square nut' and the handle grasp pose obtained via 'extruded handle of the brown square nut' have a fixed rigid transform, which must be applied correctly when inserting the nut onto the peg.
You may write python code comments for reasoning but ONLY write the executable Python code and do not write it in code fences.
The functions (APIs) below are already imported to the environment.
If you want to use numpy, or scipy for spatial transformations, you need to import it explicitly.
`,
  spill_wipe:
    MOCK +
    `
You are controlling a Franka Emika robot with API described below.
Goal: wipe up the 'brown spill'.
A sponge is already attached to your gripper/end-effector.
The table surface height is exactly z = 0.0 m, and wiping should be performed at that height (no extra offset).
Use the spill extents to inform the min/max x and y bounds of wiping motions.
Avoid large wiping motions since large deltas between inverse kinematics solutions may not guarantee optimal trajectories.
A sponge is already attached to the end-effector, and you should use a downward-facing orientation (0,0,1,0 wxyz) for wiping.
You may write python code comments for reasoning but ONLY write the executable Python code and do not write it in code fences.
The functions (APIs) below are already imported to the environment. If you want to use numpy, you need to import it explicitly.
`,
  two_arm_handover:
    MOCK +
    `
You are controlling a two-arm Franka Emika robot system with API described below.
Goal: Arm 0 should pick up the hammer, lift it, and hand it over to Arm 1. Arm 1 should then grasp the hammer handle (not hammer head). The z-value of hammer must be between 0.15 and 0.20 during the handover to count as a success.

Coordinate system:
- All pose functions accept positions in robot0's base frame (same coordinate system as returned/used by get_object_pose/goto_pose_arm*).
- The table surface is not necessarily at z=0.
- The coordinate axis follows these conventions:
  - Z-axis: up (positive) and down (negative)
  - X-axis: right (positive) and left (negative)
  - Y-axis: forward (positive) and backward (negative)

Environment details:
- Arm 0 (left) and Arm 1 (right) are positioned on opposite sides of the table.
- The hammer handle length is randomized between 0.15m and 0.25m.
- The hammer initially lies flat on the table, aligned along the Y-axis, with the handle toward +Y and the hammer head toward -Y

Critical information:
- Handover must occur near the midpoint of the initial gripper positions. Reason about the best handover hammer orientation that allows collision-free transfer to Arm 1.
- The table does not span the entire region between the two arms. If the hammer falls in the central gap it will drop to the floor, making the task UNRECOVERABLE
- AVOID COLLISIONS. You must decompose movements into rotation and translation components, moving stepwise. Reason about the optimal sequence of waypoints to safely avoid collisions.
- Arm links have volume, and intermediate motions are not collision-checked. Keep a minimum 8cm buffer between grippers

Reference quaternions:
- Arm0 gripper facing down opening along X-axis: [0, 0.707, 0.707, 0].
- Arm0 gripper facing down opening along Y-axis: [0, 1, 0, 0].
- Arm1 gripper facing down opening along Y-axis: [0, 0, 1, 0].

Arm gripper approximate initial starting positions (robot0 frame). These values are rough and may vary by a few centimeters each trial:
- Arm0: x = 0.44. y = 0.0
- Arm1: x = 1.18. y = 0.0

You may write python code comments for reasoning but ONLY write the executable Python code and do not write it in code fences.
The functions (APIs) below are already imported to the environment. If you want to use numpy, you need to import it explicitly.
`,
};

// Hand-copied from config.py's prompt_ja, prefixed like the rest.
export const TASK_PROMPTS_JA = {
  cube_lifting:
    MOCK +
    `あなたは以下のAPIでFranka Emikaロボットを制御します。
目標: 赤いキューブを掴んで持ち上げてください。
思考のためにPythonのコードコメントを書いても構いませんが、実行可能なPythonコードのみを書き、コードフェンスで囲まないでください。
以下の関数（API）は環境にすでにimportされています。numpyを使う場合は明示的にimportしてください。`,
  cube_restack:
    MOCK +
    `あなたは以下のAPIでFranka Emikaロボットを制御します。
目標: 赤いキューブを緑のキューブの上にそっと置き、その後グリッパーを開いてください。高い位置から落としてはいけません。
キューブの寸法（extent）を使って、置くべき正確な高さを計算してください。
思考のためにPythonのコードコメントを書いても構いませんが、実行可能なPythonコードのみを書き、コードフェンスで囲まないでください。
以下の関数（API）は環境にすでにimportされています。numpy、scipy、torchなどを使う場合は明示的にimportしてください。`,
  cube_stack:
    MOCK +
    `あなたは以下のAPIでFranka Emikaロボットを制御します。
目標: 赤いキューブを掴み、緑のキューブの上にそっと積んでから離してください。

重要なルール:
- get_object_pose(..., return_bbox_extent=True) が返す extent は辺の「全長」です。半分の高さには extent[2]/2 を使ってください。
- 置くときの姿勢には sample_grasp_pose が返した把持クォータニオンを使い回してください。get_object_pose のクォータニオンは姿勢の情報として信頼できないので使わないでください。
- 物体を掴む・置くために近づくときは、必ず z_approach=0.1 を指定してください。
- 掴んだ後は、横方向に移動する前にキューブを安全な高さ（Z方向に少なくとも +0.2m）まで持ち上げてください。
- 積む高さの式: place_z = green_center_z + green_extent[2]/2 + red_extent[2]/2
- 高い位置から落としてはいけません。制御された降下のために必ず z_approach を使って近づいてください。

実行可能なPythonコードのみを書いてください（コードフェンスは不要）。必要ならnumpyをimportしてください。`,
  nut_assembly:
    MOCK +
    `あなたは以下のAPIでFranka Emikaロボットを制御します。
目標: \`brown square nut\` を掴み、\`brown square block\` に挿入してください。
ナットは取っ手（handle）の部分を掴みます。取っ手をうまく掴むには、言語クエリ \`extruded handle of the brown square nut\` を試してください。
brown square nut と、その extruded handle は同じ剛体の一部です。
'extruded handle of the brown square nut' に対する把持姿勢クエリは、取っ手の領域にあるエンドエフェクタ姿勢をワールド座標系で返します。
'white hollow center of the brown square nut' で得られるナット中心の姿勢と、'extruded handle of the brown square nut' で得られる取っ手の把持姿勢の間には固定の剛体変換があり、ナットをペグに挿入するときはこれを正しく適用する必要があります。
思考のためにPythonのコードコメントを書いても構いませんが、実行可能なPythonコードのみを書き、コードフェンスで囲まないでください。
以下の関数（API）は環境にすでにimportされています。
numpyや、空間変換のためのscipyを使う場合は明示的にimportしてください。`,
  spill_wipe:
    MOCK +
    `あなたは以下のAPIでFranka Emikaロボットを制御します。
目標: 'brown spill'（茶色いこぼれ跡）を拭き取ってください。
グリッパー（エンドエフェクタ）にはすでにスポンジが取り付けられています。
テーブル面の高さはちょうど z = 0.0 m で、拭き取りはこの高さで行ってください（追加のオフセットは不要です）。
こぼれ跡の寸法（extent）を使って、拭き取り動作の x・y の最小/最大範囲を決めてください。
逆運動学の解の差が大きいと最適な軌道にならない場合があるため、大きな拭き取り動作は避けてください。
スポンジはすでにエンドエフェクタに付いているので、拭き取りには下向きの姿勢（wxyz で 0,0,1,0）を使ってください。
思考のためにPythonのコードコメントを書いても構いませんが、実行可能なPythonコードのみを書き、コードフェンスで囲まないでください。
以下の関数（API）は環境にすでにimportされています。numpyを使う場合は明示的にimportしてください。`,
  two_arm_handover:
    MOCK +
    `あなたは以下のAPIで、2本のアームからなるFranka Emikaロボットシステムを制御します。
目標: アーム0がハンマーを掴んで持ち上げ、アーム1に手渡します。アーム1はハンマーの柄（ヘッドではなく）を掴みます。受け渡しの間、ハンマーのz値が0.15〜0.20の範囲にあれば成功とみなされます。

座標系:
- すべての姿勢関数は、robot0 のベース座標系で位置を受け取ります（get_object_pose / goto_pose_arm* が返す・受け取る座標系と同じです）。
- テーブル面は必ずしも z=0 ではありません。
- 座標軸の規約:
  - Z軸: 上が正、下が負
  - X軸: 右が正、左が負
  - Y軸: 前が正、後ろが負

環境の詳細:
- アーム0（左）とアーム1（右）はテーブルを挟んで反対側に配置されています。
- ハンマーの柄の長さは 0.15m〜0.25m の範囲でランダムです。
- ハンマーは最初、テーブルの上にY軸に沿って平置きされており、柄が +Y 側、ヘッドが -Y 側を向いています。

重要な情報:
- 受け渡しは、両グリッパーの初期位置の中間点付近で行う必要があります。アーム1へ衝突なく渡せる最適なハンマーの向きを考えてください。
- テーブルは2本のアームの間の領域全体には広がっていません。ハンマーが中央の隙間に落ちると床まで落下し、タスクは復旧不能になります。
- 衝突を避けてください。動きを回転成分と並進成分に分解し、段階的に動かす必要があります。衝突を安全に避けられる最適なウェイポイントの順序を考えてください。
- アームのリンクには体積があり、中間の動きは衝突チェックされません。グリッパー間には最低 8cm の余裕を保ってください。

参考クォータニオン:
- アーム0 グリッパー下向き・X軸方向に開く: [0, 0.707, 0.707, 0]
- アーム0 グリッパー下向き・Y軸方向に開く: [0, 1, 0, 0]
- アーム1 グリッパー下向き・Y軸方向に開く: [0, 0, 1, 0]

各アームのグリッパーのおおよその初期位置（robot0 座標系）。試行ごとに数cm程度ずれることがあります:
- アーム0: x = 0.44, y = 0.0
- アーム1: x = 1.18, y = 0.0

思考のためにPythonのコードコメントを書いても構いませんが、実行可能なPythonコードのみを書き、コードフェンスで囲まないでください。
以下の関数（API）は環境にすでにimportされています。numpyを使う場合は明示的にimportしてください。`,
};

// Same format ApiBase.combined_doc() produces (capx/integrations/base_api.py),
// for the visual-tier functions in capx/integrations/franka/control.py.
export const API_DOCS = `# ${MOCK.trim()} API docs — excerpt of the visual tier, hand-copied from capx/integrations/franka/control.py

get_object_pose(object_name: str, return_bbox_extent: bool = False) -> tuple[numpy.ndarray, numpy.ndarray, numpy.ndarray | None]
  Doc:
    Get the pose of an object in the environment from a natural language description.
    The quaternion from get_object_pose may be unreliable, so disregard it and use the grasp pose quaternion OR (0, 0, 1, 0) wxyz as the gripper down orientation if using this for placement position.

    Args:
        object_name: The name of the object to get the pose of.
        return_bbox_extent:  Whether to return the extent of the oriented bounding box (oriented by quaternion_wxyz). Default is False.

    Returns:
        position: (3,) XYZ in meters.
        quaternion_wxyz: (4,) WXYZ unit quaternion.
        bbox_extent: (3,) XYZ in meters (full side length, not half-length extent). If return_bbox_extent is False, returns None.

sample_grasp_pose(object_name: str) -> tuple[numpy.ndarray, numpy.ndarray]
  Doc:
    Sample a grasp pose for an object in the environment from a natural language description.
    Do use the grasp sample quaternion from sample_grasp_pose.

    Args:
        object_name: The name of the object to sample a grasp pose for.

    Returns:
        position: (3,) XYZ in meters.
        quaternion_wxyz: (4,) WXYZ unit quaternion.

goto_pose(position: numpy.ndarray, quaternion_wxyz: numpy.ndarray, z_approach: float = 0.0) -> None
  Doc:
    Go to pose using Inverse Kinematics.
    There is no need to call a second goto_pose with the same position and quaternion_wxyz after calling it with z_approach.
    Args:
        position: (3,) XYZ in meters.
        quaternion_wxyz: (4,) WXYZ unit quaternion.
        z_approach: (float) Z-axis distance offset for goto_pose insertion approach motion. Will first arrive at position + z_approach meters in Z-axis before moving to the requested pose. Useful for more precise grasp approaches. Default is 0.0.
    Returns:
        None

open_gripper() -> None
  Doc:
    Open gripper fully.

    Args:
        None

close_gripper() -> None
  Doc:
    Close gripper fully.

    Args:
        None`;

// Canned LLM reply for prompt mode. The fenced block is what the mock's
// code extraction returns as `code`. A prompt containing "[long]" gets
// GENERATE_RESPONSE_LONG instead — enough lines to exercise output that
// outgrows the pane (WORKSHOP_WEBUI_LLM_OUTPUT.md).
export const GENERATE_RESPONSE = `${MOCK}This is a canned response from the mock backend, not an LLM.

The task is to pick up the red cube. I will sample a grasp pose, approach from above, close the gripper, and lift.

\`\`\`python
import numpy as np

# ${MOCK.trim()} generated code
grasp_pos, grasp_quat = sample_grasp_pose("red cube")
open_gripper()
goto_pose(grasp_pos, grasp_quat, z_approach=0.1)
close_gripper()
goto_pose(grasp_pos + np.array([0.0, 0.0, 0.1]), grasp_quat)
\`\`\`
`;

export const GENERATE_RESPONSE_LONG = [
  `${MOCK}This is a long canned response from the mock backend, not an LLM.`,
  "",
  ...Array.from({ length: 60 }, (_, i) => `Reasoning step ${i + 1}: consider the cube pose, the grasp approach, and the lift height.`),
  "",
  "```python",
  "import numpy as np",
  "",
  `# ${MOCK.trim()} generated code (long variant)`,
  'grasp_pos, grasp_quat = sample_grasp_pose("red cube")',
  "open_gripper()",
  "goto_pose(grasp_pos, grasp_quat, z_approach=0.1)",
  "close_gripper()",
  "goto_pose(grasp_pos + np.array([0.0, 0.0, 0.1]), grasp_quat)",
  "```",
  "",
].join("\n");
