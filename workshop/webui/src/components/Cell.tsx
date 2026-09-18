import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { RUN_SHORTCUT_LABEL } from "../shortcut";
import type { CellResult } from "../types";

const MIN_EDITOR_HEIGHT = 60;
const MAX_EDITOR_HEIGHT = 520;

export interface CellState {
  id: string;
  code: string;
  running: boolean;
  result: CellResult | null;
  error: string | null;
}

interface Props {
  index: number;
  cell: CellState;
  theme: "light" | "dark";
  onChange: (code: string) => void;
  onResetAndRun: () => void;
  // Manual-mode-only extras. Omit all three to render just the editor +
  // "リセット&Run" button (used by the prompt-engineering mode, where every
  // experiment always runs standalone against a fresh reset).
  onRun?: () => void;
  onResetAndRunUpTo?: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
  resetting?: boolean;
  readOnly?: boolean;
  // Disable the run buttons while the code is blank. Opt-in: manual mode
  // lets empty cells run (Run All walks over them), prompt mode doesn't.
  disableWhenEmpty?: boolean;
}

export default function Cell({
  index,
  cell,
  theme,
  onChange,
  onRun,
  onResetAndRun,
  onResetAndRunUpTo,
  onDelete,
  canDelete,
  resetting,
  readOnly,
  disableWhenEmpty,
}: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [height, setHeight] = useState(MIN_EDITOR_HEIGHT);
  const runBlocked = cell.running || resetting || (disableWhenEmpty && cell.code.trim() === "");

  // ⌘/Ctrl+Enter runs the cell: "▶ Run" in manual mode, "リセット&Run" in
  // prompt mode (which has no plain Run). Monaco registers the action once
  // at mount, so it reads the latest handler/state through a ref rather
  // than closing over the first render's props.
  const shortcutRef = useRef({ blocked: runBlocked, run: onRun ?? onResetAndRun });
  shortcutRef.current = { blocked: runBlocked, run: onRun ?? onResetAndRun };
  // addAction (not addCommand): the keybinding is scoped to this editor
  // instance, so with several cells the focused one runs — addCommand
  // registers globally and the last-mounted cell would win. Disposed on
  // unmount so a removed cell doesn't keep its binding alive.
  const shortcutActionRef = useRef<{ dispose(): void } | null>(null);
  useEffect(() => () => shortcutActionRef.current?.dispose(), []);

  // Grow the editor with the number of lines instead of a fixed height —
  // getContentHeight() already accounts for line count/wrapping, so this is
  // just clamped to a sane [min, max] range (beyond max it scrolls inside
  // the fixed-height box like a normal editor).
  const updateHeight = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const contentHeight = editor.getContentHeight();
    setHeight(Math.min(MAX_EDITOR_HEIGHT, Math.max(MIN_EDITOR_HEIGHT, contentHeight)));
  }, []);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    updateHeight();
    editor.onDidContentSizeChange(updateHeight);
    shortcutActionRef.current = editor.addAction({
      id: "capx.runCell",
      label: "Run cell",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, monaco.KeyMod.WinCtrl | monaco.KeyCode.Enter],
      run: () => {
        if (!shortcutRef.current.blocked) shortcutRef.current.run();
      },
    });
  };

  return (
    <div className="cell">
      <div className="cell-header">
        <span className="cell-index">[{index + 1}]</span>
        {onRun && (
          <button className="run-btn" onClick={onRun} disabled={runBlocked} title={`このセルを実行 (${RUN_SHORTCUT_LABEL})`}>
            {cell.running ? "実行中..." : "▶ Run"}
          </button>
        )}
        <button
          className="reset-run-btn"
          onClick={onResetAndRun}
          disabled={runBlocked}
          title={`環境を初期化して、このセルのみを実行${onRun ? "" : ` (${RUN_SHORTCUT_LABEL})`}`}
        >
          {resetting ? "リセット中..." : cell.running ? "実行中..." : "リセット&Run"}
        </button>
        {onResetAndRunUpTo && (
          <button
            className="reset-run-btn"
            onClick={onResetAndRunUpTo}
            disabled={cell.running || resetting}
            title="環境を初期化して、先頭からこのセルまで順番に実行"
          >
            {resetting ? "リセット中..." : "リセット&ここまでRun"}
          </button>
        )}
        {onDelete && (
          <button className="delete-btn" onClick={onDelete} disabled={!canDelete || cell.running}>
            削除
          </button>
        )}
      </div>
      <div style={{ padding: "12px 0", backgroundColor: theme === "dark" ? "#1e1e1e" : "#fffffe" }}>
        <Editor
          height={`${height}px`}
          defaultLanguage="python"
          theme={theme === "dark" ? "vs-dark" : "light"}
          value={cell.code}
          onMount={handleMount}
          onChange={(value) => onChange(value ?? "")}
          options={{
            readOnly: readOnly ?? false,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            scrollbar: { alwaysConsumeMouseWheel: false },
            // .cell clips overflow, which would cut off the suggestion
            // widget (and its signature/doc flyout) on short cells.
            fixedOverflowWidgets: true,
          }}
        />
      </div>
      {cell.error && <div className="cell-output error">{cell.error}</div>}
      {cell.result && (
        <div className="cell-output">
          <div className="cell-badges">
            <span className={cell.result.ok ? "badge badge-ok" : "badge badge-error"}>
              {cell.result.ok ? "OK" : "Error"}
            </span>
            <span className="badge">reward: {cell.result.reward.toFixed(2)}</span>
            {cell.result.task_completed && <span className="badge badge-ok">task completed</span>}
          </div>
          {cell.result.stdout && (
            <pre className="stdout">{cell.result.stdout}</pre>
          )}
          {cell.result.stderr && (
            <pre className="stderr">{cell.result.stderr}</pre>
          )}
        </div>
      )}
    </div>
  );
}
