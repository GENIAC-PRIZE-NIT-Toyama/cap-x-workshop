# Agent Mode 実装計画

前提: `WORKSHOP_LIBERO_ENV.md`（LIBERO対応の調査）、
`WORKSHOP_AGENT_ENV.md`（複数タスク同時実行の調査）を踏まえた上での
実装計画。ブランチは切ってある前提で、ここではコード変更の設計のみを書く。

新モード「Agent Mode」は既存の"manual"/"prompt"モードとUI・裏側とも
大きく異なってよいという前提で設計する（既存2モードのコード・データ
構造には触れない／壊さない）。

## 0. このワークショップで体感してほしいこと（設計の軸）

要件に書かれた狙いをそのまま設計判断の根拠として使う:

- **ReAct的な試行錯誤（Refine）をLLMにやらせる** → 1ターンで終わらず、
  LLM出力→コード実行→フィードバック→次のLLM呼び出し、を自動で回す
  **サーバー主導のループ**にする（人がボタンを押すたびに1ターン進む
  現行の"prompt"モードのSelf-Refineとは設計思想が違う）。
- **複数タスクに汎化するプロンプトを設計する力** → 1つのプロンプトを
  複数タスクに使い回せることが前提のUIにする（Phase 1では1タスクずつ
  だが、プロンプトはタスク非依存な変数だけで書けるようにする）。
- **トラジェクトリを読む力** → 各ターンの「送ったプロンプト（レンダー後）
  / LLM生出力 / 抽出したコード / stdout・stderr / 画像（あれば）」を
  時系列に並べて後から読める専用ビューを作る。
- **終了条件を書かせる経験** → タスク完了の判定をシミュレーションに
  頼らず、Agent自身にPerception APIで確認させて「もう終わり」と
  判断させるモードを用意する。`is_task_completed`はテンプレート変数として
  存在はするが、デフォルトのフィードバックテンプレートには含めない
  （見せる/見せないは参加者がテンプレートに書くかどうかで決まる）。
- **画像の有無で気づきの違いを体感する** → vision toggleは設定1つで
  ON/OFFでき、ON時は毎ターンのLLM呼び出しに現在のカメラ画像を
  base64で埋め込む。
- **計画・自己修正のためのSystem Prompt設計論** → System PromptとFeedback
  Promptの両方をJinja2テンプレートとして自由に書けるようにし、
  「何をフィードバックとして与えるか」自体を参加者の設計対象にする。

## 1. フェーズ分け

- **Phase 0（前提整備）**: LIBERO対応の最小限（`WORKSHOP_LIBERO_ENV.md`の
  うちAgent Modeが直接必要とする部分だけ）。
- **Phase 1（本体・バックエンド）**: Agent Loopの実行エンジンと新API。
- **Phase 2（本体・フロントエンド）**: Agent Mode専用UI一式。
- **Phase 3（今回は実装しない・設計だけ担保）**: 複数タスク並列
  ベンチマーク（最大10タスク程度のスコアリング）。Phase 1のAgent Loop
  実行関数がそのまま複数セッションに使い回せる形にしておく。

以下、各フェーズの詳細。

---

## Phase 0: LIBERO対応の最小整備

Agent Modeは「ROBOSUITE/LIBEROどちらでも動く」ことが要件なので、
`WORKSHOP_LIBERO_ENV.md`で洗い出した項目のうち、**Agent Loopの正しさに
直結する2点だけ**を先に直す。Dockerイメージ分離やビルド周りは
Phase 0の中でも並行着手可能だが、Agent Mode自体の実装はROBOSUITE
タスクで先に動作確認し、LIBEROイメージが用意でき次第有効化する
（ブロッキングにしない）。

### 0.1 `env_runtime.py`: LIBEROのゴール文プレースホルダを展開する

**必須。** 現状、LIBEROタスクの`task_prompt`には`{libero_environment_goal}`
という未展開文字列が残る（`WORKSHOP_LIBERO_ENV.md` §4）。Agent Modeの
`task_instruction`変数はこれをそのままテンプレートに埋め込むので、直さないと
参加者に生のプレースホルダが見える。

`EnvRuntime.reset()`に、`capx/envs/trial.py`の`_patch_libero_goal()`相当の
ロジックを移植する:

```python
def _resolve_task_prompt(env: Any, raw_prompt: str) -> str:
    """Expand LIBERO's {libero_environment_goal} placeholder if present.
    No-op for Robosuite tasks (they have no `handle.task_language`)."""
    low_level = getattr(env, "low_level_env", None)
    handle = getattr(low_level, "handle", None)
    goal = getattr(handle, "task_language", None)
    if goal and "{libero_environment_goal}" in raw_prompt:
        return raw_prompt.format(libero_environment_goal=goal)
    return raw_prompt
```

`reset()`内で`info.get("task_prompt")`を返す直前にこれを通す。

### 0.2 `env_runtime.py`: LIBEROのカメラフレーム抽出フォールバック

**推奨（vision toggleを使うなら必須）。** `_extract_frames()`は
`render_camera_names`（Robosuite専用属性）に依存しており、LIBEROでは
空になる（`WORKSHOP_LIBERO_ENV.md` §3）。Agent Modeのvision入力・
Toolbar/CameraViewの画面表示の両方に影響するので、LIBERO低レベルenvの
observation構造（`agentview`/`robot0_eye_in_hand`等の既知キー）への
フォールバックを追加する。理想はcapx側に共通インターフェースを
足すことだが、ワークショップ側だけで完結させるなら
`_extract_frames()`に「`render_camera_names`が空なら既知のLIBERO
カメラキー一覧を試す」分岐を足す形で十分。

### 0.3 `config.py` / `session_manager.py`: タスクごとのworkerイメージ選択

**Phase 1着手前に型だけ用意、実際のLIBEROイメージビルドは並行作業でよい。**
`TaskSpec`に`runtime: Literal["robosuite", "libero"] = "robosuite"`を追加し、
`SessionManager.create_session()`の`WORKER_IMAGE`定数を呼び出し側から
渡せる引数に変える（`WORKSHOP_LIBERO_ENV.md`の推奨(A)）。LIBERO用の
Dockerfile/`.dockerignore`の実整備はAgent Mode本体の実装をブロックしない
別トラックとして進める。

### 0.4 `config.py`: LIBEROタスクを最低1〜2件登録

`env_configs/libero/franka_libero_spatial_0.yaml`のような易しいタスクを
`runtime="libero"`で`TASKS`に追加。ゴール文はタスクごとに動的
（§0.1で解決）なので、`prompt_ja`は無理に用意せず`None`のままでよい
（英語原文がそのまま`task_instruction`に入る）。

---

## Phase 1: Agent Loop 実行エンジン（バックエンド）

### 1.1 設計方針：ループはサーバー側に置く

現行の"prompt"モードは「1ターン生成→人がRunボタンを押す→次のターンの
プロンプトを人が書く」という**フロント主導**のフローだが、Agent Modeは
「LLM→コード実行」を自動で繰り返す必要がある（要件: "LLM -> code
executionのループ"）。したがって:

- ループの状態（今何ターン目か、これまでの会話履歴、停止判定）は
  **バックエンドが持つ**。
- フロントは「開始」「停止」を叩き、ループが1ターン進むたびに届く
  イベントをただ描画するだけの**ビューア**に徹する。
- これは副産物として **Phase 3（複数タスク並列）とも相性が良い**：
  ループの実行関数はセッション1つに閉じた純粋な非同期処理として書けば、
  それをN個同時に起動するだけで並列化になる。フロントが逐次実行の
  オーケストレーションを頑張る必要がない。

### 1.2 新規ファイル: `workshop/backend/prompt_render.py`

System Prompt / Feedback PromptはどちらもJinja2テンプレート
（要件の`{{variable_name}}`記法）。参加者の入力を**バックエンドプロセスで
`render()`する**ため、SSTI対策として`jinja2.sandbox.SandboxedEnvironment`
必須。未定義変数はデフォルトの空文字フォールバックだと事故に気づけないので
`StrictUndefined`にし、エラーメッセージに使える変数一覧を含める。

```python
from jinja2.sandbox import SandboxedEnvironment
from jinja2 import StrictUndefined, TemplateError

_ENV = SandboxedEnvironment(undefined=StrictUndefined, autoescape=False)

class PromptRenderError(Exception):
    pass

def render_template(template_str: str, variables: dict[str, Any]) -> str:
    try:
        return _ENV.from_string(template_str).render(**variables)
    except TemplateError as exc:
        available = ", ".join(sorted(variables.keys()))
        raise PromptRenderError(f"{exc}. 使える変数: {available}") from exc
```

フロントの「プレビュー」機能（後述 §2.2）用に、実行を伴わずダミー値
またはこれまでの実データでレンダー結果だけ返す用途にも使う。

### 1.3 新規ファイル: `workshop/backend/agent_loop.py`

#### リクエスト/設定

```python
class AgentRunRequest(BaseModel):
    system_prompt: str          # Jinja2. {{api_document}}, {{task_instruction}} が使える
    feedback_prompt: str        # Jinja2. {{stdout}}, {{stderr}}, {{turn}}, {{max_turns}},
                                 # {{is_task_completed}}（デフォルトのテンプレ例には含めない）
    vision_enabled: bool = False
    termination_mode: Literal["simulation", "agent"] = "agent"
    max_turns: int = 10         # 安全弁。termination_modeに関わらず必ず効く
    settings: dict[str, float] = {}
```

#### 変数の出処

- `api_document`: 既存の`EnvRuntime.api_docs`（起動済みタスクのAPI群から
  自動生成済み、Robosuite/LIBERO非依存 — 変更不要）。
- `task_instruction`: `EnvRuntime.reset()`が返す`task_prompt`
  （§0.1の修正後はLIBEROでも展開済みの文字列）。
- `stdout`/`stderr`: 各ターンの`run_cell()`結果。
- `turn`/`max_turns`: ループの現在ターン・上限。
- `is_task_completed`: 各ターンの`run_cell()`結果の`task_completed`
  （`None`もあり得る — Robosuiteの一部・`task_completed()`未実装タスクでは
  `None`になるため、テンプレート内で`is_task_completed is none`分岐を
  書けるようにしておく）。

#### コードブロック抽出：**最後のブロックだけ**

既存の`code_extract.extract_code()`（最初のブロックを取る、"prompt"
モード用）はそのまま触らない。Agent Mode専用に新しい関数を追加する:

```python
def extract_last_code_block(text: str) -> str | None:
    """Returns the last fenced code block's body, or None if the response
    contains no fenced code block at all (used as the agent's own
    "I'm done" signal in termination_mode="agent")."""
    matches = list(_FENCED_PYTHON.finditer(text)) or list(_FENCED_ANY.finditer(text))
    if not matches:
        return None
    return matches[-1].group(1).strip()
```

`None`を「フェンス無し」として明確に返す点が既存`extract_code()`
（フェンスが無ければ全文をコードとみなす、"prompt"モード用の挙動）との
意図的な違い。途中のコードブロックは内省・検討過程の一部として無視する
（要件通り）。

#### 終了条件

3つの独立したチェックをORで評価する:

1. **`no_code_block`**: 直前のLLM出力から`extract_last_code_block()`が
   `None`を返した → **`termination_mode`に関わらず常に停止**
   （要件「コードブロックがなければ終了」）。これが実質的な
   「Agentが自分で終了を判断する」メカニズムそのもの — 参加者が
   System/Feedback Promptに「完了したらコードを書かず終了理由だけ
   書いてください」のような指示を書けば、Agentはコードを出さずに
   ループを終えられる。
2. **`task_completed`**: `termination_mode == "simulation"`のときだけ、
   直前ターンの実行結果`task_completed is True`で停止。
   `termination_mode == "agent"`のときはこのチェックをスキップする
   （シミュレーションに頼らず、Agent自身の判断=①だけに委ねる）。
3. **`max_turns`**: ターン数が上限に達したら強制停止（安全弁、常時有効）。

#### ループ本体（概形）

```python
async def run_agent_loop(
    manager: SessionManager, session_id: str, req: AgentRunRequest,
) -> AsyncIterator[dict]:
    session = manager._require(session_id)  # 既存の内部ヘルパーを再利用
    reset_result = await manager.reset(session_id)
    variables = {
        "api_document": reset_result["api_docs"],
        "task_instruction": reset_result["task_prompt"],
    }
    system_text = render_template(req.system_prompt, variables)
    messages: list[dict] = [{"role": "user", "content": _to_content(system_text, reset_result["frames"], req.vision_enabled)}]

    for turn in range(1, req.max_turns + 1):
        yield {"type": "turn_start", "turn": turn}

        full_text = ""
        async for delta in _stream(messages, req.settings):  # llm_client.stream_chat_completion をスレッドでラップ
            full_text += delta
            yield {"type": "llm_delta", "turn": turn, "text": delta}
            if _stop_requested(session_id):
                yield {"type": "loop_done", "status": "stopped", "turn": turn}
                return

        code = extract_last_code_block(full_text)
        messages.append({"role": "assistant", "content": full_text})

        if code is None:
            yield {"type": "loop_done", "status": "agent_finished", "turn": turn}
            return

        result = await manager.run_cell(session_id, f"agent-turn-{turn}", code)
        feedback_vars = {
            **variables, "stdout": result["stdout"], "stderr": result["stderr"],
            "turn": turn, "max_turns": req.max_turns,
            "is_task_completed": result.get("task_completed"),
        }
        feedback_text = render_template(req.feedback_prompt, feedback_vars)
        messages.append({"role": "user", "content": _to_content(feedback_text, result["frames"], req.vision_enabled)})

        yield {
            "type": "turn_done", "turn": turn, "llm_raw": full_text, "code": code,
            "stdout": result["stdout"], "stderr": result["stderr"],
            "frames": result["frames"] if req.vision_enabled else None,
            "task_completed": result.get("task_completed"),
        }

        if req.termination_mode == "simulation" and result.get("task_completed"):
            yield {"type": "loop_done", "status": "task_completed", "turn": turn}
            return
        if _stop_requested(session_id):
            yield {"type": "loop_done", "status": "stopped", "turn": turn}
            return

    yield {"type": "loop_done", "status": "max_turns", "turn": req.max_turns}
```

`_stop_requested()`は`session_id`をキーにしたプロセス内`set[str]`
（stop APIがここに追加、ループが消費）で十分 — 単一プロセスの
FastAPIバックエンドなので外部ストアは不要。

#### Vision入力：マルチパートメッセージ

```python
def _to_content(text: str, frames: dict[str, str], vision_enabled: bool) -> str | list[dict]:
    if not vision_enabled or not frames:
        return text
    # primary_camera_name() 相当を使うか、frames の最初の1枚を使う。
    camera = next(iter(frames))
    data_url = f"data:image/jpeg;base64,{frames[camera]}"
    return [
        {"type": "text", "text": text},
        {"type": "image_url", "image_url": {"url": data_url}},
    ]
```

`frames`の値は`_encode_rgb_jpeg()`が返す素のbase64文字列（data URIの
プレフィックス無し — 既存のWebSocket/CameraView契約を変えないため）
なので、ここで`data:image/jpeg;base64,`を足す。`llm_client.py`の
`stream_chat_completion()`は`messages: list[dict]`をそのままvLLMへ
フォワードするだけの実装なので、**型ヒントを`list[dict[str, str]]`から
`list[dict[str, Any]]`に広げる以外、変更不要**。vLLM側にVision対応モデルが
served model として立っている前提（運用側の責務、コード変更なし）。

### 1.4 新規/変更API（`app.py`）

- `POST /api/sessions/{id}/agent/run` — 本体。`AgentRunRequest`を受け、
  `run_agent_loop()`をSSEで流す。実装パターンは既存の
  `/experiments/generate`（`app.py:211-`）のSSE配線をほぼ踏襲できる
  （別スレッドで同期ジェネレータを回す部分だけ、ここでは
  `run_agent_loop`自体がasyncなので素直に`async for`でよく、
  既存より単純になる）。
- `POST /api/sessions/{id}/agent/stop` — `_stop_requested`用のフラグを立てる。
- 既存の`/reset`・`/cells/run`・`/replay`・`/observation`・`/stream`は
  無変更で再利用（Agent Loopも内部的にはこれらを呼んでいるだけ）。

### 1.5 テンプレート変数のドキュメント化

フロントのAPI docsパネル（既存`ApiDocsModal`）と同じ思想で、
「Agent Modeで使える変数一覧」を返す軽量エンドポイントか、単に
固定の説明文をフロント側に埋め込むかは実装時に決める（バックエンドで
一元管理したいなら`GET /api/agent/variables`のような静的リストを
生やしてもよい）。

---

## Phase 2: Agent Mode UI（フロントエンド）

既存モードのコンポーネント（`Cell.tsx`/`PromptExperimentPanel.tsx`）は
**一切変更しない**。Agent Mode専用の新規コンポーネント群を追加し、
`App.tsx`の`mode === "agent"`分岐で丸ごと差し替える。

### 2.1 データモデル（`notebooks.ts`拡張）

```ts
export type NotebookMode = "manual" | "prompt" | "agent";

export interface AgentConfig {
  systemPrompt: string;
  feedbackPrompt: string;
  visionEnabled: boolean;
  terminationMode: "simulation" | "agent";
  maxTurns: number;
  settings: GenerationSettings;
}

export interface AgentTurnEvent {
  turn: number;
  llmRaw: string;
  code: string;
  stdout: string;
  stderr: string;
  taskCompleted: boolean | null;
  // frames は持たせるが localStorage には永続化しない（既存の
  // 「frames/videoは保存しない」方針を踏襲）
}

export interface AgentRunResult {
  status: "task_completed" | "agent_finished" | "max_turns" | "stopped" | "error";
  turns: AgentTurnEvent[];
}
```

`Notebook`型に`agentConfig?: AgentConfig`を追加（"agent"モード用）。
直近1回の`AgentRunResult`も保存可能にし、リロード後もトラジェクトリを
読み返せるようにする（`PromptExperiment`の永続化方針と同じ粒度）。

### 2.2 新規コンポーネント

- **`AgentConfigPanel.tsx`**: System Prompt / Feedback Prompt の
  Jinja2テキストエディタ（Monaco、プレーンテキストモードで可）、
  vision toggle、termination mode toggle（"simulation" / "agent"の
  トグル、`is_task_completed`がテンプレートで使えることの説明を
  併記）、max turns、temperature等の設定。
- **プレビューボタン**: バックエンドの`render_template()`を
  実行せずローカルでダミー値を当てるか、直近ターンの実データで
  レンダー結果を見せる軽量エンドポイント（`POST /api/agent/preview`、
  `EnvRuntime`起動不要・純粋にJinja2レンダーするだけなので新規に
  作っても安価）を呼ぶ。テンプレートのタイポに気づかせるための
  必須機能（Jinja初心者向けの安全網）。
- **`AgentTrajectoryView.tsx`**: `AgentTurnEvent[]`を時系列カードで
  表示。各カードに「LLM生出力（コード抽出部分をハイライト）」
  「実行したコード」「stdout/stderr」「画像（vision ON時のみ、
  サムネイル）」「task_completed（分かっている場合のみ、バッジ表示）」。
  ストリーミング中は最新ターンのLLM出力をタイプライター風に追記表示
  （SSEの`llm_delta`をそのまま流し込む）。
- **`AgentRunControls.tsx`**: 「開始」「停止」「環境リセット」ボタン、
  ループの現在ステータス（実行中/turn N/終了理由）表示。

### 2.3 `App.tsx`側の配線

- `mode === "agent"`のとき、既存の`cells`/`experiments`ではなく
  `agentConfig`と`agentResult`という新設のstateを使う（既存stateには
  触れない）。
- SSE購読: 新規`useCallback`で`fetch`ベースのSSE読み取り
  （`streamGenerate`の実装パターンを流用可能）を`agent/run`に向ける。
  受信した`turn_start`/`llm_delta`/`turn_done`/`loop_done`イベントを
  `agentResult`に追記していくだけの単純なreducerで足りる
  （既存"prompt"モードのように複数ターンをユーザーが手で編集する
  機構が要らないぶん、状態管理は既存2モードよりむしろ単純になる）。
- カメラ映像: 既存の`/stream` WebSocketと`CameraView`をそのまま
  再利用してよい（Agent Loopも内部で`run_cell`を呼んでいるので、
  既存のライブ配信の仕組みに自然に乗る）。

### 2.4 複数タスクへの拡張の"入口"だけ用意する（Phase 3への布石）

Phase 2ではUIを凝らないが、`AgentConfig`は最初から「1タスクに紐づかない
形」で設計しておく（`taskId`を`AgentConfig`自体には持たせず、
起動時に別引数として渡す）。これにより、Phase 3で「同じ`AgentConfig`を
複数タスクに配って一括実行する」オーケストレーション層を足すときに、
Phase 2で作ったコンポーネント（`AgentConfigPanel`/`AgentTrajectoryView`）を
タスクの数だけ並べるだけで再利用できる（`WORKSHOP_AGENT_ENV.md`
§2.1で指摘した「タスク単位で自己完結するコンポーネントへの抽出」を
Agent Modeでは最初からその形で作る、ということ）。

---

## Phase 3（今回は実装しない・設計の受け皿だけ）

- `run_agent_loop()`は1セッションに閉じた非同期関数なので、
  複数タスクのベンチマークは「N個のセッションを作り、Nつの
  `run_agent_loop()`を`asyncio.gather`で（並列）または`for`ループで
  （逐次）回し、各セッションの`loop_done`イベントの`status`を集計する」
  だけで実現できる見込み。バックエンド側の追加実装は薄い
  オーケストレーション層1枚で済む。
- スコアは「`status == "task_completed"`かつ`is_task_completed`が
  最終的に真だったタスク数 / 全タスク数」。`termination_mode == "agent"`で
  実行した場合でも、ループ終了後に`observation()`や最後の`run_cell`結果の
  `task_completed`を見れば成否は判定できる（終了理由としては
  使わなくても、採点のためだけに参照する）。
- UIは`WORKSHOP_AGENT_ENV.md`で書いたタイル表示＋フォーカス表示の
  2階層構成を想定。Phase 2のコンポーネントをそのまま子として
  埋め込める設計にしてあるので、Phase 3は主にレイアウトと
  一括実行ボタンの追加になる見込み。

---

## 変更ファイル一覧（Phase 0〜2）

| ファイル | 変更内容 |
|---|---|
| `workshop/backend/env_runtime.py` | LIBEROゴール文展開、LIBEROカメラ抽出フォールバック |
| `workshop/backend/config.py` | `TaskSpec.runtime`追加、LIBEROタスク登録 |
| `workshop/backend/session_manager.py` | `WORKER_IMAGE`をタスクごとに選択可能に |
| `workshop/backend/code_extract.py` | `extract_last_code_block()`追加（既存関数は無変更） |
| `workshop/backend/prompt_render.py` | 新規: SandboxedEnvironmentでのJinja2レンダー |
| `workshop/backend/agent_loop.py` | 新規: `AgentRunRequest`・`run_agent_loop()` |
| `workshop/backend/llm_client.py` | 型ヒントのみ変更（`content`のマルチパート許容） |
| `workshop/backend/app.py` | `/agent/run`・`/agent/stop`（・任意で`/agent/preview`）追加 |
| `workshop/webui/src/notebooks.ts` | `"agent"`モード・`AgentConfig`/`AgentTurnEvent`型追加 |
| `workshop/webui/src/components/AgentConfigPanel.tsx` | 新規 |
| `workshop/webui/src/components/AgentTrajectoryView.tsx` | 新規 |
| `workshop/webui/src/components/AgentRunControls.tsx` | 新規 |
| `workshop/webui/src/api.ts` | Agent Mode用のSSE購読関数追加 |
| `workshop/webui/src/App.tsx` | `mode === "agent"`分岐の配線追加 |

---

## 決定事項（確定）

- `termination_mode`のデフォルトは`"agent"`（Agent自身に判断させる）。
  `"simulation"`は「答え合わせ用の楽なモード」として明示的に選ばせる。
- Vision送信は`frames`の最初の1枚（タスクのprimaryカメラ）のみ。
  wrist視点はPhase 2以降のオプションとして後回し。
- `max_turns`のデフォルトは10。
- LIBEROタスクの初出しタイミングに縮退案は不要。Phase 0→1→2の順で
  段階的に実装を進める。
