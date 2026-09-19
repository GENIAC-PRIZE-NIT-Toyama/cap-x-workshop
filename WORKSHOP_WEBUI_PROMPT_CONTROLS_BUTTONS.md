# CaP-X Workshop WebUI プロンプトモードの操作性向上（停止・キャンセル・コピー・モード記憶）

## 概要

プロンプトエンジニアリングモード（`PromptExperimentPanel.tsx`）およびノートブック開始画面（`TaskSelect.tsx`）において、試行をスムーズに行えるよう、以下の4点の改善を実施した。

1. LLMコード生成の停止機能: 生成中に中断できる停止ボタンを設置。途中終了時も受信済みコードを出力。
2. Self-Refineのキャンセル機能: 「Self-Refineを追加」を押した際、直前ターンに安全に戻せるボタンを設置。
3. 各種コピー機能: プロンプト・LLM出力・生成コードのそれぞれをワンクリックでクリップボードにコピー可能にした。
4. ノートブックモードの永続化: 毎回手動モードに戻ってしまうのを防ぐため、選択中モードおよび最後に開いたノートブックのモードを `localStorage` に記録・追従するようにした。

## 変更内容

### Frontend

- `workshop/webui/src/api.ts`:
  - `streamGenerate` に `signal?: AbortSignal` 引数を追加し、`fetch` に渡す。
  - 中断時に発生する `AbortError` をキャッチし、エラー終了とせず、それまでに受信した `fullText` と抽出コードを返して安全に終了する。
  - `extractCode` を改修: 生成途中で停止した場合にマークダウンの閉じタグが存在しないケースに対応。未閉塞でも正規表現で抽出できるようにし、コードブロック末尾の中途半端なバッククォートを除去してコードセルに反映。
- `workshop/webui/src/App.tsx`:
  - `abortGenRef = useRef<AbortController | null>(null)` で生成の AbortController を管理。
  - `handleStopGenerate` を追加し、実行中の `abortGenRef.current?.abort()` を呼び出す。
  - `handleCancelRefineTurn` を追加し、`turns.slice(0, -1)` で最新ターンを取り消して直前のターン状態に戻す。
  - `handleStartNew` および `handleOpenNotebook` の実行時に `localStorage.setItem("defaultNotebookMode", mode)` を更新。
- `workshop/webui/src/components/PromptExperimentPanel.tsx`:
  - 生成中に「生成」ボタンの横に赤色の「■ 停止」ボタン（`.stop-btn`）を表示。
  - Self-Refine ターン（`lastIdx > 0`）かつ非生成時に、「生成」ボタンの右隣に「✕ Self-Refineをキャンセル」ボタン（`.delete-btn`）を表示。
  - インラインの `CopyButton` コンポーネントを追加（クリック時に 1.5 秒間 `✓ コピー完了` と緑色でフィードバック）。
  - 「プロンプト（アクティブターン・折りたたみ履歴）」、「LLM出力（summary 内）」、「生成されたコード（セル上部）」の各箇所にコピーボタンを配置。
- `workshop/webui/src/components/TaskSelect.tsx`:
  - 初期モード `mode` を `localStorage.getItem("defaultNotebookMode")` から読み込み（フォールバックは直近保存ノートブックのモードまたは `"manual"`）。
  - 手動/プロンプトの切り替え時に `localStorage` を更新。
  - 保存済みノートブックの「開く」ボタン押下時にも、そのノートブックの `mode` を `defaultNotebookMode` に保存。
- `workshop/webui/src/styles.css`:
  - `.stop-btn`: 赤色のアクションボタンスタイル。
  - `.copy-btn`: 小さめの補助ボタンスタイル。`.copied` 状態時の緑色表示、およびホバー時に全体ボタンスタイルで色が上書きされないよう優先度を考慮したスタイル定義。
  - `.prompt-header-row`, `.llm-output-summary`: コピーボタンとラベルを左右均等（`space-between`）に配置するレイアウト。

## 設計判断

- **停止時の未閉塞コード抽出**: 閉じバッククォート（```）未生成の途中停止でも、正規表現でコード部分のみをセルに反映し、手動修正できるようにした。
- **キャンセルボタンの配置**: 「Self-Refineを追加」直後の取り消しやすさを考慮し「生成」ボタンの右隣に配置。
- **インライン定義**: `CopyButton` はパネル固有の小さな UI なので別ファイル化せず同ファイル末尾に定義。
- **LLM出力コピーの配置**: `<details>` の開閉状態を問わず、ストリーミング中もコピーできるよう `summary` 行の右端に配置。
- **モード記憶の追従**: 手動切り替え時だけでなくノートブックを開いた際にもモードを保存し、次回初期画面の選択状態を自然に追従させた。

## 影響範囲

- 既存の手動モード（セル編集・実行・リセット等）の動作には一切影響なし。
- プロンプトモードでのストリーミング生成処理が AbortController 経由になり、ユーザーによる途中停止が可能になった。
- ローカルストレージに `defaultNotebookMode` キーが保存される。

## テスト結果

- コード生成停止: 生成中に「■ 停止」を押すと即座にストリーミングが止まり、それまでに受信されたコードがセルに反映される。
- 未閉塞コードの抽出: コードブロック途中で停止しても、` ```python ` ヘッダーや途中末尾のバッククォートがセルに入らず、Python コードのみが抽出されることを確認。
- Self-Refine キャンセル: Self-Refine ターン追加後にキャンセルボタンを押すと、追加されたターンが消え、直前の実行結果・コードがそのまま保持された状態に戻る。
- コピー機能:
  - プロンプトのコピー、LLM出力のコピー、生成コードのコピーがすべてクリップボードに正常に書き込まれる。
  - ボタン押下時に緑色の「✓ コピー完了」に切り替わり、1.5秒後に元に戻る。マウスホバー時も緑色が青で上書きされない。
- モード記憶:
  - プロンプトモードを選択後、またはプロンプトモードのノートブックを開いた後にリロードしても、初期画面で「プロンプトエンジニアリング」が選択状態となる。
- `tsc -b && npm run build` がエラーなく通過。
