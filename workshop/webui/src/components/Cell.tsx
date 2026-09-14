import { useCallback, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
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
  onChange: (code: string) => void;
  onRun: () => void;
  onDelete: () => void;
  canDelete: boolean;
}

export default function Cell({ index, cell, onChange, onRun, onDelete, canDelete }: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [height, setHeight] = useState(MIN_EDITOR_HEIGHT);

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

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    updateHeight();
    editor.onDidContentSizeChange(updateHeight);
  };

  return (
    <div className="cell">
      <div className="cell-header">
        <span className="cell-index">[{index + 1}]</span>
        <button className="run-btn" onClick={onRun} disabled={cell.running}>
          {cell.running ? "実行中..." : "▶ Run"}
        </button>
        <button className="delete-btn" onClick={onDelete} disabled={!canDelete || cell.running}>
          削除
        </button>
      </div>
      <Editor
        height={`${height}px`}
        defaultLanguage="python"
        theme="vs-dark"
        value={cell.code}
        onMount={handleMount}
        onChange={(value) => onChange(value ?? "")}
        options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
      />
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
