# LIBEROタスクをWorkshop WebUIで実行可能にするための調査

## 前提

Workshop WebUIは `workshop/backend/config.py` の `TASKS` リストに登録された
Robosuiteタスクだけを実行できる。実装は capx 本体（`capx/envs/...`）を
config駆動 (`env_configs/*.yaml` → Hydra風 `_target_` instantiate) で呼び出す
薄いオーケストレーション層で、Robosuite固有の知識をハードコードしている
箇所は多くない。一方 capx 本体には **LIBERO対応がすでに実装済み**
（`capx/envs/simulators/libero.py`、`capx/envs/tasks/franka/franka_libero_env.py`、
`capx/integrations/franka/libero.py`、`env_configs/libero/*.yaml`）であり、
ゼロから作る必要はない。問題は「capxにある実装」と「Workshopのsandbox/
WebUI層」の間にあるギャップを埋める作業である。

## 結論（TL;DR）

最大のブロッカーは **依存関係の競合**（`pyproject.toml` の
`[tool.uv] conflicts` が `robosuite` extraと `libero` extraを排他指定して
いる）。これにより、現行の1イメージ構成のままではRobosuiteタスクと
LIBEROタスクを同じworkerコンテナに同居させられない。次点で、
(1) Dockerビルドコンテキストが `LIBERO-PRO`/`libero_dependencies` を明示的に
除外している、(2) `env_runtime.py` のカメラ抽出・保存カメラ名の解決が
Robosuite専用の属性（`render_camera_names`/`save_camera_name`）に依存して
おり、LIBEROの低レベルenvには存在しない、(3) LIBEROタスクのゴール文
（`{libero_environment_goal}`）を実際の言語文へ差し込む処理
（`capx/envs/trial.py` の `_patch_libero_goal`）がWorkshop側の
`env_runtime.py` には移植されておらず、そのままでは `task_prompt` に
プレースホルダ文字列が出てしまう、という3点が主要な作業になる。

いずれも「不可能」なレベルの問題ではなく、Workshop側に数十〜百数十行の
差分を入れる作業で解決できる。ただし依存関係の競合解消（別ワーカー
イメージに分けるか、robosuiteフォークを統一するか）が設計判断として
必要で、これが工数の中心になる。

## 調査結果の詳細

### 1. 依存関係の競合（最重要ブロッカー）

`pyproject.toml` の `libero` extraは `robosuite`（PyPI名だが実体は
`capx/third_party/libero_dependencies/robosuite`、`Max-Fu/robosuite` の
`maxf/egl_context` ブランチ）を要求する。一方Workshopが現在使っている
`robosuite` extraは `capx/third_party/robosuite`（`uynitsuj/robosuite`
フォーク）を指す。`[tool.uv] conflicts` はこの2 extraを明示的に
「同時インストール不可」としている（pyproject.toml:144-147）。

```toml
conflicts = [
  [
    { extra = "robosuite" },
    { extra = "libero" },
  ],
  ...
]
```

Workshopのworkerイメージ（`workshop/backend/docker/Dockerfile:62`）は
`uv sync --frozen --no-dev --extra robosuite` でビルドされている。ここに
単純に `--extra libero` を足すことはuvのconflict宣言によりできない。

**選択肢:**
- **(A) worker イメージをタスク種別ごとに分離する。** `capx-workshop-worker:robosuite` と
  `capx-workshop-worker:libero` の2イメージをビルドし、`session_manager.py`
  がタスクの種別（`TaskSpec` に持たせる新フィールド、例: `runtime: "robosuite" | "libero"`）
  に応じて起動するイメージを切り替える。実装コストは低く、既存タスクに
  無影響。ただしCIやビルド手順が2系統になる。
- **(B) 依存関係を統一する。** どちらかのRobosuiteフォークに一本化し、
  conflict宣言を外す。capx本体（Workshop外）に影響する変更であり、
  他のcapx利用箇所（RL学習パイプライン等）に波及するリスクが高い。
  今回のスコープでは非推奨。

(A) を推奨する。Workshopはすでに「タスクごとにconfig_pathを切り替える」
設計なので、「タスクごとにworkerイメージを切り替える」拡張は自然な延長。

### 2. Dockerビルドコンテキストからの除外

`workshop/backend/docker/Dockerfile.dockerignore` は明示的に以下を除外
している:

```
capx/third_party/LIBERO-PRO
capx/third_party/libero_dependencies
```

LIBERO用イメージをビルドするなら、これらのディレクトリをビルド
コンテキストに含める必要がある（除外リストから外す、または
LIBERO用の別 `.dockerignore` を用意する）。両方のサブモジュールは
`git submodule update --init` 済みであることが前提（`.gitmodules` に
`capx/third_party/LIBERO-PRO` と `capx/third_party/libero_dependencies/robosuite`
が登録済み）。

### 3. `env_runtime.py` のRobosuite依存箇所

`workshop/backend/env_runtime.py` は「どのRobosuiteタスクでも動く」ことを
前提に、低レベルenvの以下の属性を直接参照している:

- `_extract_frames()`: `low_level.render_camera_names` を走査してカメラ画像を
  取得（env_runtime.py:46-64）。この属性は `capx/envs/simulators/robosuite_base.py`
  でのみ定義されており、`capx/envs/simulators/libero.py` の
  `FrankaLiberoEnv` には存在しない。`getattr(..., [])` でフォールバックする
  実装なので例外にはならないが、**LIBEROタスクでは画面カメラ画像が
  一切送られなくなる**（wrist視点のみ `render_wrist()` 経由で残る）。
- `primary_camera_name()`: `getattr(self._env.low_level_env, "save_camera_name", "robot0_robotview")`
  も同様にRobosuite専用の属性で、LIBEROでは常にフォールバック値
  `"robot0_robotview"` になり、リプレイ動画の主カメラ指定が事実上無効化される。

LIBERO側（`capx/envs/simulators/libero.py`）はobservation辞書の中に
`agentview`/`robot0_eye_in_hand` 等のカメラキーを直接持っている
（`franka_libero_env.py` の例示コード中に見える `obs["agentview"]["images"]["rgb"]`）。
`_extract_frames()` をLIBEROのobs構造にも対応させる（例:
`getattr(low_level, "render_camera_names", None)` が無ければ既知の
LIBEROカメラキー一覧にフォールバックする、あるいは低レベルenv側に
両シミュレータ共通の `camera_names` プロパティを追加してもらう）必要がある。
後者（capx側にインターフェースを揃えてもらう）の方が筋が良い。

### 4. タスクゴール文のプレースホルダ問題

LIBEROタスクの `env_configs/libero/*.yaml` のプロンプトは

```
Goal: {libero_environment_goal}
```

という未展開のプレースホルダを含む。この展開処理は
`capx/envs/trial.py` の `_patch_libero_goal()`（trial.py:952-966）にしか
実装されておらず、`capx/envs/tasks/base.py` の汎用 `reset()`/`step()`
（Workshopの `EnvRuntime` が呼んでいる経路）は展開を行わない。

結果として、現状のまま `EnvRuntime.reset()` を呼ぶと、
`info["task_prompt"]`（および `TaskSpec.prompt_ja` 相当の日本語文）に
生の `{libero_environment_goal}` という文字列がそのまま出てしまう。

対応: `EnvRuntime.reset()` 内で `_patch_libero_goal` 相当のロジックを移植し、
`self._env.low_level_env.handle.task_language`（LIBEROタスクの場合のみ
存在）から実際のゴール文を取り出して `task_prompt` に埋め込む。

さらに、`config.py` の `TaskSpec.prompt_ja` は「capxタスククラスの
`PROMPT` 定数を人手で和訳して埋め込む」設計（config.py:34-38のコメント）
だが、LIBEROは1つの汎用クラス（`FrankaLiberoCodeEnv`）を
`suite_name`/`task_id` の組み合わせで多数のタスクに使い回す。つまり
「タスクごとに英語ゴール文が変わる」ため、既存の「クラスに対して1つの
和訳を書く」運用が成立しない。LIBEROタスクを featured 展開するなら、
`suite_name`/`task_id` の組ごとに和訳を用意する（=採用するLIBEROタスクを
絞り込んで個別に和訳する）運用に倣うのが現実的。

### 5. Perception APIサーバー側は追加不要（朗報）

`env_configs/libero/franka_libero_spatial_0.yaml` の `api_servers` は
`launch_pyroki_server` / `launch_contact_graspnet_server` /
`launch_sam3_server` の3つで、これは既存のRobosuiteタスク
（例: `cube_lifting`）と全く同じ構成。`workshop/docker/docker-compose.yml`
が現在プロキシしているPerception API（SAM3/GraspNet/PyRoKi）のみで足り、
`two_arm_lift` のように追加でOWL-ViT+SAM2サーバーを立てる必要はない。
APIクラスも `FrankaLiberoApi`（`capx/integrations/franka/libero.py`）が
既にあり、Robosuite側の `FrankaControlApi` と役割は近い。

### 6. フロントエンド（webui）は概ね無関係

`workshop/webui/src` および `mock-server` を検索した限り、"robosuite"を
名指しでハードコードしている箇所はない。タスク一覧・プロンプト・API docs
はすべてバックエンドから渡される値をそのまま表示する作りなので、
`config.py` に LIBERO の `TaskSpec` を追加するだけでUI側の変更は
基本的に不要と見込まれる（動作確認は必要）。

### 7. その他の確認事項（未検証・要実機確認）

- LIBEROの `OffScreenRenderEnv`（`capx/integrations/libero/__init__.py`
  経由）のレンダリングバックエンドがWorkshopのDockerfile前提
  （`MUJOCO_GL=egl` 想定、`libegl1`/`libglvnd0` を apt install 済み）と
  適合するかは実機ビルド・実行で要確認。`libero_dependencies/robosuite`
  が `maxf/egl_context` ブランチを使っている点から、EGLコンテキスト周りに
  Robosuite本家フォークと異なる前提がある可能性がある。
- `capx/envs/simulators/libero.py` 冒頭の `vendor_root` 計算
  （`capx/third_party/LIBERO`）は実在しないパスを指しており（実際の
  submoduleは `LIBERO-PRO`）、`capx/integrations/libero/__init__.py` 側は
  正しく `LIBERO-PRO` を指している。`libero.py` トップレベルの
  `from libero import benchmark` 等はこの誤ったパス解決に依存している
  可能性があるため、`uv sync --extra libero` でパッケージとして
  正しくインストールされていれば無害（sys.path追加なしでもimport可能）
  だが、vendor切り替えで動かす運用にする場合は要修正。
- リソース制限（`session_manager.py` の `--memory`/`--pids-limit`/GPU
  passthrough）は現状Robosuite想定の値になっている。LIBERO
  （MuJoCoベースだが異なるフォーク・異なるシーン規模）で同じ値が
  妥当かは負荷試験が必要。

## 推奨する作業ステップ（概算）

1. **`git submodule update --init` の対象に `LIBERO-PRO` と
   `libero_dependencies/robosuite` を追加**し、ローカル/CI環境で
   `uv sync --extra libero` が単独で通ることを確認する。
2. **LIBERO専用のworkerイメージを新設**（`workshop/backend/docker/Dockerfile.libero`
   等）。`.dockerignore` からLIBERO関連ディレクトリの除外を外し、
   `uv sync --frozen --no-dev --extra libero` でビルドする。
3. **`session_manager.py` にタスク種別に応じたイメージ選択を追加**
   （`TaskSpec` に `runtime` フィールドを追加し、`config.py` の
   LIBEROタスクではLIBEROイメージを指定）。
4. **`env_runtime.py` のカメラ抽出処理をLIBERO対応に拡張**
   （`render_camera_names`/`save_camera_name` が無い場合のフォールバック、
   もしくはcapx側に共通インターフェースを追加）。
5. **`env_runtime.py` の `reset()` にLIBEROゴール文の展開処理を追加**
   （`_patch_libero_goal` 相当のロジックを移植）。
6. **`config.py` にLIBEROタスクを1〜2件、`TaskSpec` として追加**
   （`env_configs/libero/franka_libero_spatial_0.yaml` 等の易しいタスクから）。
   ゴール文の和訳をタスクごとに手書きする。
7. **実機での通し動作確認**（reset→コード生成→run_cell→replay→
   Perceptionパネルまで一通り）。EGL/レンダリング周りの不整合が
   出た場合はここで対応。

1〜3が「環境を分離して動かせるようにする」ための基盤作業、4〜6が
「Workshop UI上で違和感なく使える」ための統合作業、7が検証。全体として
中規模の作業量（既存コードへの局所的な変更が中心で、新規実装は少ない）。
