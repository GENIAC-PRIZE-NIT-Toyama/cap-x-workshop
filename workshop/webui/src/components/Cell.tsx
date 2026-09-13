import Editor from "@monaco-editor/react";
import type { CellResult } from "../types";

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
        height="160px"
        defaultLanguage="python"
        theme="vs-dark"
        value={cell.code}
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
