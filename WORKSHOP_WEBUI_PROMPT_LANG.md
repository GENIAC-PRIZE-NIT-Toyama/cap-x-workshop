# CaP-X Workshop WebUI タスクプロンプトの英日切り替え

> 位置づけ: 変更記録（実装済み）。
> 前提: `WORKSHOP_WEBUI_SPEC.md` §1.1（タスクレジストリ）と §3.1（Frontend）を読了済みであることを前提に書いている。動作確認は `WORKSHOP_WEBUI_LOCAL_DEV.md` のモックバックエンドで行った。

## 概要

セッション画面の上部に表示されるタスクプロンプト（`App.tsx` の `task-prompt` バナー）は、capx のタスククラスが持つ英語の `PROMPT` 定数（例: `capx/envs/tasks/franka/franka_lift.py:3-8`）がそのまま表示されていた。WebUI の他の文言はすべて日本語なので、参加者向けにここも日本語で読めるようにし、英語原文にも切り替えられるようにした。

## 変更内容

### Backend

- `workshop/backend/config.py`: `TaskSpec` に `prompt_ja: str | None = None` を追加し、6タスクすべてに日本語訳を入れた。英語原文の意味を落とさないことを優先し、API名・座標・数値はそのまま残している
- `workshop/backend/app.py`: `POST /api/sessions` と `POST /api/sessions/{id}/reset` のレスポンスに `task_prompt_ja` を追加。`task_prompt`（英語）は従来通り Worker 由来で、`task_prompt_ja` は `config.py` からそのまま返す

### Frontend

- `workshop/webui/src/components/TaskPromptBanner.tsx`（新規）: バナー本体。文言の右端に「日本語 | EN」のトグルを置く。`task_prompt_ja` が `null` のタスクでは英語のみを表示し、トグルを出さない
- `workshop/webui/src/App.tsx`: `SessionInfo` に `taskPromptJa` を追加し、セッション作成・保存済みノートブックを開く・環境リセットの3経路で `task_prompt_ja` を保持する。言語の選択は `promptLang` ステートで持ち、`localStorage`（キー `promptLang`）に記憶する。既定は `"ja"`
- `workshop/webui/src/types.ts`: `CreateSessionResponse` と `ResetResponse` に `task_prompt_ja: string | null` を追加
- `workshop/webui/src/styles.css`: `.task-prompt` を flex にして文言とトグルを横並びにし、`.task-prompt-lang-btn` を追加

### Mock

- `workshop/webui/mock-server/fixtures.js` / `server.js`: 本物と同じ形で `task_prompt_ja` を返す（`config.py` の `prompt_ja` の手動コピー、`[MOCK]` 付き）

## 設計判断

- **日本語訳は `config.py` に置く。** `WORKSHOP_WEBUI_SPEC.md` §1.1 は「タスクの追加・変更は `config.py` の `TASKS` を編集するだけで完結させる」という設計で、タスク説明文（`description`）の日本語も既にそこにある。プロンプトの日本語だけをフロントの辞書に置くと、タスクの日本語文言が `config.py` と TypeScript に分散し、片方だけ直し忘れる余地ができる。主催者が当日タスクを差し替えるとき触る場所を1箇所に保つ
- **英語原文はバックエンド（Worker 経由）のまま、日本語だけ追加する。** 環境が実際に使っているプロンプトは英語であり、日本語は読むための補助。英語を `config.py` に複製しない（capx 側の `PROMPT` が変わったときに二重管理になる）
- **日本語がデフォルト。** UI の他の文言がすべて日本語で、参加者も日本語話者。英語は「原文を見たい」ときの切り替え先
- **トグルはバナー内。** 切り替わるのはバナーの文言だけなので、その隣に置く。ツールバーに置くと何が切り替わるのかが離れて見えにくい
- **選択は `localStorage` に記憶する。** テーマ（`theme`）と同じ方式。セッションを跨いでも、リロードしても保たれる
- **表示は従来通り1段落のまま。** 原文には改行や箇条書きがあるが、`white-space: pre-wrap` にするとバナーの高さが大きく増えてエディタとカメラの領域を圧迫するため、改行を潰した1段落表示を維持した。日本語訳も同じ扱い
- **`prompt_ja` が無いタスクではトグルを出さない。** `None` を「日本語なし」の意味に使い、フロントは英語のみを表示する。新しいタスクを追加するとき、訳を後回しにしても画面が壊れない

## 影響範囲

- `task_prompt` の扱いは変えていない。プロンプトモードの「生成」に送られるメッセージにタスクプロンプトは含まれない（参加者が自分で書く設計。`App.tsx` の `newExperiment` のコメント参照）ので、LLM に渡る内容には影響しない
- API レスポンスにキーが1つ増える（`task_prompt_ja`）。既存キーは変更なし
- `config.py` の `prompt_ja` は capx の `PROMPT` の手動翻訳で、自動同期しない。capx 側のプロンプトを変えたら訳も更新する（`TaskSpec` のコメントに明記）

## テスト結果

モックバックエンド（`WORKSHOP_WEBUI_LOCAL_DEV.md`）＋ Chromium で確認。本物の Backend ではローカルで実行できないため、`app.py` / `config.py` は `py_compile` と `config.py` 単体 import（6タスクの `prompt_ja` が入っていること）まで。

- 初期表示が日本語、バナー右端に「日本語 | EN」
- EN に切り替えると英語原文に変わり、`localStorage.promptLang` が `"en"` になる
- EN のまま環境リセットしても EN が維持される（reset レスポンスの `task_prompt_ja` で再設定しても選択は変わらない）
- リロードして別タスクを開いても EN が維持される
- `tsc -b` と `npm run build` が通る

## 備考

- `package.json` への追加はなし
- 翻訳は人手。cube_stack と two_arm_handover は原文が長く箇条書きを含むが、1段落表示のため箇条書きの `-` はそのまま文中に残る（英語表示と同じ見え方）
