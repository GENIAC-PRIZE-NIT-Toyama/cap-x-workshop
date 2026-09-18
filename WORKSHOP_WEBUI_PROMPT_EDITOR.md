# CaP-X Workshop WebUI プロンプト欄の高さをコードブロックに揃える

> 位置づけ: 変更記録（実装済み）。
> 前提: `WORKSHOP_WEBUI_SPEC.md` §3.1（Frontend）を読了済みであることを前提に書いている。動作確認は `WORKSHOP_WEBUI_LOCAL_DEV.md` のモックバックエンドで行った。

## 概要

プロンプトモードのプロンプト欄（`PromptExperimentPanel.tsx` の `<textarea class="prompt-editor">`）は、高さが `rows=10` 固定で、右下のグリップを手でドラッグして縦に伸ばす作りだった（`styles.css` の `resize: vertical`）。同じ画面のコードブロック（`Cell.tsx` の Monaco Editor）は内容の行数に応じて自動で高さが変わるため、同じ画面に2種類の挙動が並んでいた。プロンプト欄もコードブロックと同じ「内容に応じて自動で伸縮、上限を超えたら内部スクロール」に揃えた。

## 変更内容

- `workshop/webui/src/components/PromptExperimentPanel.tsx`: `textarea` に `ref` を持たせ、`userText` が変わるたびに `scrollHeight` から高さを計算して `style.height` に反映する。上限は `Cell.tsx` と同じ 520px（`MAX_EDITOR_HEIGHT`）。`rows` 属性は外した（最小高さは CSS の `min-height` で決める）
- `workshop/webui/src/styles.css`: `.prompt-editor` の `resize: vertical` を `resize: none` に、`overflow-y: hidden` を追加。`min-height: 160px` は維持。上限に達したときだけ `PromptExperimentPanel.tsx` 側が `overflow-y: auto` に切り替える

## 設計判断

- **見た目は変えず、挙動だけ揃える。** Monaco Editor に置き換えれば見た目も完全に同じになるが、プロンプトは散文で、行番号は不要、折り返しとプレースホルダーは `textarea` の方が素直。Self-Refine で自動挿入される stdout/stderr 入りの長文にも行番号が付いてしまう
- **最小高さは 160px のまま。** コードブロックは 60px から始まるが、プロンプトは最初から数行書く前提なので、空の状態でも書く場所だとわかる高さを残す
- **上限はコードブロックと同じ 520px。** 上限を超えたら内部スクロールにする点も揃える。上限なしにすると長い Self-Refine プロンプトで欄が画面を占有する
- **高さの計算は `userText` を依存に持つ `useLayoutEffect` で行う。** 入力時だけでなく、Self-Refine ターンを追加してプロンプトが差し替わったとき、保存済みノートブックを開いたときにも正しい高さになる。`onChange` の中で計算すると後者2つが漏れる。描画前に高さを確定させたいので `useEffect` ではなく `useLayoutEffect`
- **`overflow-y` は普段 `hidden`、上限に達したときだけ `auto`。** `auto` のままだと、内容が高さにぴったり収まっていても Chromium が `textarea` に 15px のスクロールバー領域を確保してしまい（`scrollHeight === clientHeight` なのに `clientWidth` が 15px 減る）、右側に空のスクロールバーが出る。`hidden` で高さを測り、必要高さが上限を超えるときだけ `auto` にする

## 影響範囲

- プロンプト欄の見た目（枠・フォント・配色）と、送信されるプロンプトの内容は変わらない
- 手動で高さを変える手段はなくなる（自動に一本化）
- 手動モード（コードブロックのみ）には影響しない

## テスト結果

モックバックエンド＋ Chromium で確認。

- 空の状態で 160px。15行で 328px、1行に戻すと 160px に縮む
- 40行で 520px に止まり、欄の中でスクロールする（このときだけスクロールバーが出る）
- 収まっているときはスクロールバーの領域が確保されない（`offsetWidth - clientWidth` が枠線分の 2px のみ）
- 右下のリサイズグリップが出ない（`resize: none`）
- 生成→実行→「+ Self-Refineを追加」で stdout/stderr 入り10行のプロンプトに差し替わったとき、246px でぴったり収まる
- `tsc -b` と `npm run build` が通る

## 備考

- `package.json` への追加はなし
