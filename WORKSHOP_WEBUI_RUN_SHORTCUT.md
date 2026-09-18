# CaP-X Workshop WebUI ⌘/Ctrl+Enter で生成・実行する

> 位置づけ: 変更記録（実装済み）。
> 前提: `WORKSHOP_WEBUI_SPEC.md` §3.1（Frontend）を読了済みであることを前提に書いている。動作確認は `WORKSHOP_WEBUI_LOCAL_DEV.md` のモックバックエンドで行う。

## 概要

プロンプトの「生成」とコードセルの実行は、いずれもボタンをクリックするしかなかった。他のノートブック系サービス（Jupyter / Colab など）と同じく、キーボードから **⌘+Enter（Mac）/ Ctrl+Enter（Windows・Linux）** で発火できるようにする。

案内は常時表示しない。ボタンにカーソルを乗せて少し待つとツールチップに「(⌘+Enter)」のように出る。気づいた人だけが使えればよい、という位置づけ。

## 対象

| 場所 | 入力欄 | ⌘/Ctrl+Enter の動作 |
|---|---|---|
| プロンプト欄 | `textarea.prompt-editor`（`PromptExperimentPanel.tsx`） | 「生成」 |
| プロンプトモードのコードセル | Monaco（`Cell.tsx`） | 「リセット&Run」 |
| 手動モードのコードセル | Monaco（`Cell.tsx`） | 「▶ Run」 |

手動モードの「リセット&Run」「リセット&ここまでRun」にはショートカットを付けない。Jupyter / Colab の Ctrl+Enter は「このセルだけ実行」で、それに対応するのは「▶ Run」。環境をリセットする操作は明示的にボタンを押す。

## 変更内容

- `workshop/webui/src/shortcut.ts`（新規）: `isRunShortcut(e)`（`Enter` かつ `metaKey || ctrlKey`）と、OS に応じた表記 `RUN_SHORTCUT_LABEL`（`⌘+Enter` / `Ctrl+Enter`）
- `workshop/webui/src/components/PromptExperimentPanel.tsx`: `textarea` の `onKeyDown` で ⌘/Ctrl+Enter を捕まえ、変換中でなく「生成」が押せる状態なら `onGenerate` を呼ぶ。「生成」ボタンに `title="生成 (⌘+Enter)"`
- `workshop/webui/src/components/Cell.tsx`: Monaco の `onMount` で `editor.addCommand` を `KeyMod.CtrlCmd | Enter` と `KeyMod.WinCtrl | Enter` の2つ登録。`onRun` があればそれ（手動モード）、なければ `onResetAndRun`（プロンプトモード）を呼ぶ。ボタンが押せない状態（実行中・リセット中）では何もしない。対応するボタンの `title` にショートカットを追記（手動モードは `▶ Run` に、プロンプトモードは `リセット&Run` に）

## 設計判断

- **⌘ と Ctrl の両方を受け付ける。** `textarea` は `e.metaKey || e.ctrlKey`、Monaco は `KeyMod.CtrlCmd` と `KeyMod.WinCtrl` の両方を登録する。OS を判別して片方だけにするコードは書かない。Mac で Ctrl+Enter が効いても害はない
- **ボタンが押せない状態ではキーでも発火しない。** 生成中・実行中・リセット中はボタンが `disabled` になる。ショートカットも同じ条件で無効にし、「ボタンで起きないことがキーでは起きる」状態を作らない。Monaco の `addCommand` はマウント時の1回だけ登録されるため、最新の状態とコールバックは `ref` 経由で参照する（クロージャに古い値が残るのを避ける）
- **日本語入力の変換中は無視する。** `textarea` では `e.nativeEvent.isComposing` が真なら何もしない。変換確定の Enter と誤爆させない。Monaco は IME 変換中のキーバインドを自前で抑制するので追加対応は不要
- **案内は `title` 属性。** ホバーして少し待つと出るブラウザ標準のツールチップで、Colab の「セルを実行 (⌘/Ctrl+Enter)」と同じ体験になる。出るまでの時間はブラウザ固定（およそ 0.5〜1 秒）で調整できないが、自前のツールチップを実装するほどの価値はない
- **表記は OS で出し分ける。** `title` に「⌘+Enter」と「Ctrl+Enter」を併記すると長い。`navigator.platform` が Mac なら `⌘`、それ以外は `Ctrl` にする。判定を誤っても案内が変わるだけで動作は変わらない（両方受け付けるため）
- **手動モードのショートカットは「▶ Run」だけ。** 3つの実行ボタンのうち、他サービスの慣例に対応するものを1つ選ぶ。増やすとキーの組み合わせを覚える負担が増え、「気づいた人だけ」の位置づけと合わない

## 影響範囲

- キー操作の追加のみ。クリック操作・送信内容・バックエンドには影響しない
- `textarea` 内で ⌘/Ctrl+Enter が改行として扱われることはなくなる（ブラウザ標準では ⌘/Ctrl+Enter は改行を入れないので、実質変化なし）
- Monaco の既定キーバインドで ⌘/Ctrl+Enter は「下に行を挿入」に割り当てられている。これを上書きするので、その操作はできなくなる。Colab / Jupyter と同じ割り当てなので、参加者の期待に沿う

## テスト結果

モックバックエンド＋ Chromium で確認。

| 場所 | 操作 | 結果 |
|---|---|---|
| プロンプト欄 | ⌘+Enter | 「生成」が走り、LLM 出力とコード欄が出る |
| プロンプト欄 | Ctrl+Enter | 同上（Mac でも効く） |
| プロンプト欄（生成中） | ⌘+Enter | 何も起きない。`textarea` と「生成」が `disabled` で、合成キーイベントを送っても再生成されず、ストリーミングが継続する |
| プロンプトモードのコードセル | ⌘+Enter | 「リセット&Run」が走り、結果が出る。Monaco の既定動作（下に行を挿入）は起きず、コードは8行のまま |
| 手動モードのコードセル | ⌘+Enter | 「▶ Run」が走り、結果が出る（環境リセットはしない） |

- `title`: 「生成」は `生成 (⌘+Enter)`、手動モードの `▶ Run` は `このセルを実行 (⌘+Enter)`、プロンプトモードの `リセット&Run` は `環境を初期化して、このセルのみを実行 (⌘+Enter)`。手動モードの `リセット&Run` には付かない
- `tsc -b` と `npm run build` が通る

## 備考

- `package.json` への追加はなし
- `fix/keep-generated-code-cell`（PR #7）と `Cell.tsx` の同じ箇所（実行ボタンの `disabled` 判定）に触れるため、両方をマージする際にコンフリクトの解消が要る可能性がある
