# CaP-X Workshop WebUI 利用可能なAPIのコード補完

> 位置づけ: 変更記録（実装済み）。
> 前提: `WORKSHOP_WEBUI_SPEC.md` §1.2（Perception APIの層）と §3.1（Frontend）を読了済みであることを前提に書いている。動作確認は `WORKSHOP_WEBUI_LOCAL_DEV.md` のモックバックエンドで行った。

## 概要

コードセル（`Cell.tsx` の Monaco Editor）には補完の設定がなく、Monaco 既定の**単語ベース補完**（同じ言語のエディタ内に出現した単語を候補にする）だけが効いていた。そのため `get_object_pose` などの API 関数は、一度自分で書いた後でないと候補に出ない（出ても種別は「Text」で、シグネチャや説明は付かない）。

セッション開始時点から API 関数が補完候補に出るようにした。候補には関数のシグネチャと説明文（`api_docs` 由来）を付ける。

## 変更内容

- `workshop/webui/src/apiDocs.ts`（新規）: `api_docs`（`ApiBase.combined_doc()` の出力）をパースして `{ name, signature, doc }` の配列にする。書式は `name(signature) -> ret` の行で1関数が始まり、続く `  Doc:` 以下のインデント行が説明文
- `workshop/webui/src/App.tsx`: セッションの `apiDocs` が決まったら、`useMonaco()` で得た Monaco に `registerCompletionItemProvider("python", …)` で補完プロバイダを登録する。セッション終了・`apiDocs` 変更時に `dispose()` して登録し直す
- `workshop/webui/src/components/Cell.tsx`: Monaco の `fixedOverflowWidgets: true` を追加。`.cell` は `overflow: hidden`（`styles.css`）なので、1行しかないセルでは補完ウィジェットがセルの枠で切れて候補が数件しか見えず、シグネチャ・説明文の詳細パネルも切れていた。ウィジェットを `position: fixed` で描画してクリップの外に出す

## 設計判断

- **候補は API 関数だけ。** `numpy` 等のライブラリは対象にしない。「使えるAPIは常に同じ」（`WORKSHOP_WEBUI_SPEC.md` §1.2）で、参加者に覚えてほしいのはこの関数群なので、候補をそこに絞る
- **確定時に挿入するのは関数名だけ。** 引数のプレースホルダ付きスニペットは入れない。シグネチャは候補の `detail` に、説明文は `documentation` に出すので、引数はそれを見て書く
- **候補の元データはバックエンドの `api_docs` をパースする。** フロントに関数一覧を持たない。`api_docs` はタスクの API tier に応じて Worker が生成する（`ApiDocsModal` と同じ出所）ので、tier を変えても候補が自動で追従し、フロントに二重管理が生まれない
- **プロバイダは `App.tsx` でセッション単位に登録する。** `Cell` ごとに登録すると同じ候補が重複して出る。Monaco の補完プロバイダは言語（`python`）に対して登録するもので、セッション中の全セルに効く。`ApiDocsModal` の読み取り専用エディタも `python` なので候補は出るが、読み取り専用なので実害はない
- **単語ベース補完は残す。** 一度書いた変数名が候補に出る挙動は参加者がそれに頼っているので維持する。Monaco（VS Code）は「いずれかのプロバイダが候補を返したら、より低い優先度の単語ベース補完は出さない」という動きをするため、API プロバイダを登録しただけでは単語ベース補完が消える。そこで、プロバイダの中で API 候補に加えて**同じ言語のモデル全体から単語を集めた候補（種別: Text）も返す**。API 名と重複する単語は除く

## 影響範囲

- 補完候補の内容だけ。送信されるコードやバックエンドには影響しない
- 手動モード・プロンプトモードのどちらのコードセルにも効く（同じ `Cell`）
- `api_docs` の書式が `combined_doc()` から変わるとパースが空になり、API 候補が出なくなる（単語ベース補完は残る）。エラーにはしない

## テスト結果

モックバックエンド＋ Chromium で確認。モックの `api_docs` は visual tier の5関数（`get_object_pose`, `sample_grasp_pose`, `goto_pose`, `open_gripper`, `close_gripper`）。

- 何も書いていないセルで `get_` と打つと `get_object_pose` が候補に出る（種別: Function、`detail` にシグネチャ、`documentation` に説明文）
- `g` だけで5関数すべてが候補に出る（Monaco のあいまい一致。`open_gripper` 等も `g` を含むため）
- 確定すると関数名だけが挿入される（`(` や引数は付かない）
- セル1に `grasp_pos, grasp_quat = sample_grasp_pose("red cube")` と書いた後、セル2で `gr` と打つと `grasp_pos` / `grasp_quat`（Text）が候補に出る — 単語ベース補完が残っている
- セル2で `sam` と打つと `sample_grasp_pose`（Function）が1件だけ。セル1に同じ単語があっても Text の重複は出ない
- 1行のセルで候補5件と詳細パネル（シグネチャ・説明文）がセルの枠で切れずに表示される（`fixedOverflowWidgets`）。なお `fixedOverflowWidgets` はエディタ生成時にしか効かないため、HMR ではなくリロードで確認した
- `tsc -b` と `npm run build` が通る

## 備考

- `package.json` への追加はなし（`useMonaco` は `@monaco-editor/react` に含まれる）
