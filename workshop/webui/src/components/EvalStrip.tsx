import type { EvalStatus } from "../api";
import type { AgentRunView } from "../agentEvents";

export interface EvalJobState {
  jobId: string;
  taskId: string;
  name: string;
  state: "pending" | "booting" | "running" | "done";
  sessionId: string | null;
  success: boolean;
  status: EvalStatus | null;
  detail: string | null;
  view: AgentRunView;
}

// "LIBERO: Ketchup into Basket (Object)" -> "Ketchup"
export function shortTaskName(name: string): string {
  return name.replace(/^LIBERO: /, "").replace(/ into Basket.*$/, "");
}

function chipIcon(j: EvalJobState): string {
  if (j.state === "pending") return "⏳";
  if (j.state === "booting") return "…";
  if (j.state === "running") return "▶";
  if (j.status === "skipped") return "–";
  if (j.status === "error") return "⚠";
  return j.success ? "✓" : "✗";
}

function chipClass(j: EvalJobState): string {
  if (j.state === "done") {
    if (j.status === "skipped") return "skipped";
    if (j.status === "error") return "error";
    return j.success ? "success" : "fail";
  }
  return j.state;
}

interface Props {
  jobs: EvalJobState[];
  viewedId: string | null;
  running: boolean;
  stopping: boolean;
  onSelect: (jobId: string) => void;
  onStop: () => void;
  onClose: () => void;
}

// Progress strip of a generalization test: one chip per task (click to look
// at that task's run below) and the running score.
export default function EvalStrip({ jobs, viewedId, running, stopping, onSelect, onStop, onClose }: Props) {
  const ok = jobs.filter((j) => j.success).length;
  const done = jobs.filter((j) => j.state === "done").length;
  return (
    <div className="eval-strip">
      <div className="eval-strip-head">
        <span className="eval-strip-title">汎化テスト</span>
        <span className="eval-score">
          {ok}
          <span className="eval-score-den">/{jobs.length}</span>
        </span>
        <span className="muted">{running ? `${done}/${jobs.length} タスク終了` : "完了"}</span>
        <span className="eval-strip-spacer" />
        {running ? (
          <button type="button" className="stop-btn" onClick={onStop} disabled={stopping}>
            {stopping ? "停止中..." : "■ 停止"}
          </button>
        ) : (
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        )}
      </div>
      <div className="eval-chips">
        {jobs.map((j) => (
          <button
            key={j.jobId}
            type="button"
            className={`eval-chip ${chipClass(j)}${viewedId === j.jobId ? " viewed" : ""}`}
            onClick={() => onSelect(j.jobId)}
            title={j.name}
          >
            <span className="eval-chip-icon">{chipIcon(j)}</span>
            {shortTaskName(j.name)}
          </button>
        ))}
      </div>
    </div>
  );
}
