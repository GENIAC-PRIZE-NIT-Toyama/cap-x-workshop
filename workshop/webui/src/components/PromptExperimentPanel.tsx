import { useState, useLayoutEffect, useRef } from "react";
import Cell, { type CellState } from "./Cell";
import type { GenerationSettings, PromptExperiment } from "../notebooks";
import { RUN_SHORTCUT_LABEL, isRunShortcut } from "../shortcut";
import type { CellResult } from "../types";

// Same ceiling as Cell.tsx's MAX_EDITOR_HEIGHT so the prompt box and the
// code block below it grow and stop growing the same way.
const MAX_PROMPT_HEIGHT = 520;

// How far (px) the streaming output's bottom edge may sit below the pane's
// visible bottom before we treat it as "the user scrolled away" and stop
// following. Our own scrolls land at 0, so only a user scroll exceeds it.
const FOLLOW_THRESHOLD = 40;

// Transient, per-turn execution state — mirrors CellState's running/result/
// error fields, but kept outside the persisted PromptTurn (notebooks.ts)
// since frames/reward/perception_steps are never saved, only stdout/stderr
// (via PromptTurn.lastRun, written once a run completes).
export interface TurnRunState {
  running: boolean;
  result: CellResult | null;
  error: string | null;
}

// Transient, per-experiment UI state (not persisted).
export interface ExperimentUiState {
  generating: boolean;
  streamingText: string;
  genError: string | null;
  runStates: Record<number, TurnRunState>;
}

export function newExperimentUiState(): ExperimentUiState {
  return { generating: false, streamingText: "", genError: null, runStates: {} };
}

interface Props {
  index: number;
  experiment: PromptExperiment;
  ui: ExperimentUiState;
  theme: "light" | "dark";
  resetting: boolean;
  onUpdateTurnText: (turnIndex: number, text: string) => void;
  onUpdateTurnSettings: (turnIndex: number, settings: GenerationSettings) => void;
  onUpdateTurnCode: (turnIndex: number, code: string) => void;
  onGenerate: (turnIndex: number) => void;
  onStopGenerate?: () => void;
  onResetAndRun: (turnIndex: number) => void;
  onAddRefineTurn: () => void;
  onCancelRefineTurn?: () => void;
  onDeleteExperiment: () => void;
  canDelete: boolean;
}

export default function PromptExperimentPanel({
  index,
  experiment,
  ui,
  theme,
  resetting,
  onUpdateTurnText,
  onUpdateTurnSettings,
  onUpdateTurnCode,
  onGenerate,
  onStopGenerate,
  onResetAndRun,
  onAddRefineTurn,
  onCancelRefineTurn,
  onDeleteExperiment,
  canDelete,
}: Props) {
  const lastIdx = experiment.turns.length - 1;
  const activeTurn = experiment.turns[lastIdx];
  const activeRunState = ui.runStates[lastIdx] ?? { running: false, result: null, error: null };
  const hasRunOnce = activeRunState.result !== null;
  const generateBlocked = ui.generating || resetting;

  // Keyed on the text (not onChange) so a turn swap or a notebook load also
  // gets the right height, not just typing. Resetting to auto first lets
  // the box shrink when lines are deleted. Measured with overflow hidden
  // and only switched to auto once clamped: with auto, Chromium keeps a
  // scrollbar gutter on a textarea even when the content fits exactly.
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.overflowY = "hidden";
    el.style.height = "auto";
    const needed = el.scrollHeight + el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(MAX_PROMPT_HEIGHT, needed)}px`;
    el.style.overflowY = needed > MAX_PROMPT_HEIGHT ? "auto" : "hidden";
  }, [activeTurn.userText]);

  // While streaming, keep the bottom of the output in view by scrolling the
  // enclosing pane (the page itself never scrolls — .pane does). Following
  // stops when the user scrolls up and resumes once they come back near
  // the bottom.
  const outputRef = useRef<HTMLPreElement>(null);
  const followRef = useRef(true);

  const outputOverhang = () => {
    const pre = outputRef.current;
    const pane = pre?.closest(".pane");
    if (!pre || !pane) return null;
    return { pane, overhang: pre.getBoundingClientRect().bottom - pane.getBoundingClientRect().bottom };
  };

  useLayoutEffect(() => {
    if (!ui.generating) return;
    followRef.current = true;
    const pane = outputRef.current?.closest(".pane");
    if (!pane) return;
    const onScroll = () => {
      const o = outputOverhang();
      if (o) followRef.current = o.overhang <= FOLLOW_THRESHOLD;
    };
    pane.addEventListener("scroll", onScroll);
    return () => pane.removeEventListener("scroll", onScroll);
  }, [ui.generating]);

  useLayoutEffect(() => {
    if (!ui.generating || !followRef.current) return;
    const o = outputOverhang();
    if (o && o.overhang > 0) o.pane.scrollTop += o.overhang;
  }, [ui.generating, ui.streamingText]);

  // When a generation finishes, the output collapses and the extracted code
  // appears below it — bring that code block into view, since the output
  // the user was following just disappeared from under them. The Monaco
  // cell mounts small and grows once it loads, so instead of aligning its
  // (not yet final) bottom edge, keep its top visible with room for the
  // tallest it can get (Cell.tsx clamps at 520px).
  const codeRef = useRef<HTMLDivElement>(null);
  const wasGeneratingRef = useRef(false);
  useLayoutEffect(() => {
    const finished = wasGeneratingRef.current && !ui.generating;
    wasGeneratingRef.current = ui.generating;
    if (!finished || !activeTurn.extractedCode) return;
    const code = codeRef.current;
    const pane = code?.closest(".pane");
    if (!code || !pane) return;
    const paneRect = pane.getBoundingClientRect();
    const top = code.getBoundingClientRect().top - paneRect.top;
    const room = Math.min(MAX_PROMPT_HEIGHT, paneRect.height) + 12;
    if (top < 0 || top + room > paneRect.height) pane.scrollTop += top - 12;
  }, [ui.generating, activeTurn.extractedCode]);

  const cellState: CellState = {
    id: `${experiment.id}-turn-${lastIdx}`,
    code: activeTurn.extractedCode,
    running: activeRunState.running,
    result: activeRunState.result,
    error: activeRunState.error,
  };

  return (
    <div className="experiment">
      <div className="experiment-header">
        <span className="cell-index">実験 [{index + 1}]</span>
        <button className="delete-btn" onClick={onDeleteExperiment} disabled={!canDelete}>
          削除
        </button>
      </div>

      {experiment.turns.slice(0, lastIdx).map((turn, i) => (
        <details key={i} className="prompt-turn-history">
          <summary>ターン{i + 1}(完了) — クリックして表示</summary>
          <div className="prompt-turn-history-body">
            <div className="prompt-header-row">
              <div className="prompt-turn-label">送信したプロンプト</div>
              <CopyButton text={turn.userText} label="コピー" />
            </div>
            <pre className="prompt-text-readonly">{turn.userText}</pre>
            <div className="prompt-header-row">
              <div className="prompt-turn-label">LLMの出力</div>
              <CopyButton text={turn.llmRawResponse} label="コピー" />
            </div>
            <pre className="prompt-text-readonly">{turn.llmRawResponse}</pre>
            {turn.lastRun && (
              <>
                {turn.lastRun.stdout && <pre className="stdout">{turn.lastRun.stdout}</pre>}
                {turn.lastRun.stderr && <pre className="stderr">{turn.lastRun.stderr}</pre>}
              </>
            )}
          </div>
        </details>
      ))}

      <div className="prompt-turn active">
        <div className="prompt-header-row">
          <div className="prompt-turn-label">
            {lastIdx === 0 ? "プロンプト" : `Self-Refine プロンプト(ターン${lastIdx + 1})`}
          </div>
          <CopyButton text={activeTurn.userText} label="プロンプトをコピー" />
        </div>
        <textarea
          ref={promptRef}
          className="prompt-editor"
          value={activeTurn.userText}
          onChange={(e) => onUpdateTurnText(lastIdx, e.target.value)}
          onKeyDown={(e) => {
            if (!isRunShortcut(e) || e.nativeEvent.isComposing || generateBlocked) return;
            e.preventDefault();
            onGenerate(lastIdx);
          }}
          disabled={ui.generating}
          placeholder="LLMに送るプロンプトを自由に編集してください。"
        />

        <div className="generation-settings">
          <label>
            temperature
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={activeTurn.settings.temperature}
              onChange={(e) =>
                onUpdateTurnSettings(lastIdx, { ...activeTurn.settings, temperature: Number(e.target.value) })
              }
              disabled={ui.generating}
            />
          </label>
          <button
            className="run-btn"
            onClick={() => onGenerate(lastIdx)}
            disabled={generateBlocked}
            title={`生成 (${RUN_SHORTCUT_LABEL})`}
          >
            {ui.generating ? "生成中..." : "生成"}
          </button>
          {ui.generating && onStopGenerate && (
            <button className="stop-btn" onClick={onStopGenerate} type="button">
              ■ 停止
            </button>
          )}
          {lastIdx > 0 && onCancelRefineTurn && !ui.generating && (
            <button
              type="button"
              className="delete-btn"
              onClick={onCancelRefineTurn}
              disabled={resetting}
              title="このSelf-Refineターンをキャンセルして前のターンに戻る"
              style={{ marginLeft: "0" }}
            >
              ✕ Self-Refineをキャンセル
            </button>
          )}
        </div>

        {ui.genError && <p className="error">生成に失敗しました: {ui.genError}</p>}

        {(ui.generating || activeTurn.llmRawResponse) && (
          <details className="llm-output" open={ui.generating}>
            <summary>
              <div className="llm-output-summary">
                <span>LLM出力{ui.generating ? "(ストリーミング中...)" : ""}</span>
                <CopyButton
                  text={ui.generating ? ui.streamingText : activeTurn.llmRawResponse}
                  label="出力をコピー"
                />
              </div>
            </summary>
            <pre ref={outputRef} className="prompt-text-readonly">
              {ui.generating ? ui.streamingText : activeTurn.llmRawResponse}
            </pre>
          </details>
        )}

        {/* Keyed on "a generation completed", not on the code itself —
            the code is freely editable and clearing it must not remove
            the cell. */}
        {activeTurn.llmRawResponse && (
          <div ref={codeRef}>
            <div className="prompt-header-row" style={{ marginTop: "14px", marginBottom: "6px" }}>
              <div className="prompt-turn-label" style={{ fontWeight: 600 }}>生成されたコード</div>
              <CopyButton text={activeTurn.extractedCode} label="コードをコピー" />
            </div>
            <Cell
              index={lastIdx}
              cell={cellState}
              theme={theme}
              onChange={(code) => onUpdateTurnCode(lastIdx, code)}
              onResetAndRun={() => onResetAndRun(lastIdx)}
              resetting={resetting}
              disableWhenEmpty
            />
          </div>
        )}

        {hasRunOnce && (
          <button className="reset-run-btn refine-btn" onClick={onAddRefineTurn} disabled={ui.generating}>
            + Self-Refineを追加(stdout/stderrを踏まえて修正)
          </button>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text, label = "コピー" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`copy-btn ${copied ? "copied" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      disabled={!text}
      title="クリップボードにコピー"
    >
      {copied ? "✓ コピー完了" : `${label}`}
    </button>
  );
}
