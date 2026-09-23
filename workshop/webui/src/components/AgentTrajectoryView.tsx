import type { AgentTurnEvent, AgentLoopStatus } from "../notebooks";

// Finds the *last* fenced code block in `text` (mirrors code_extract.py's
// extract_last_code_block()) and splits the string around it, so the raw
// LLM output can be rendered with that block visually set apart from the
// reasoning text around it — this is what "コード抽出部分をハイライト"
// (WORKSHOP_AGENT_PLAN.md §2.2) means in practice: it's not a separate
// re-extraction, just a rendering aid over the same text the code came
// from.
function splitLastCodeBlock(text: string): { before: string; block: string; after: string } | null {
  const matches = [...text.matchAll(/```[a-zA-Z0-9]*\n[\s\S]*?```/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const start = last.index ?? 0;
  const end = start + last[0].length;
  return { before: text.slice(0, start), block: text.slice(start, end), after: text.slice(end) };
}

function LlmOutput({ text }: { text: string }) {
  const split = splitLastCodeBlock(text);
  if (!split) return <pre className="prompt-text-readonly">{text}</pre>;
  return (
    <pre className="prompt-text-readonly agent-llm-output">
      {split.before}
      <span className="agent-llm-output-code">{split.block}</span>
      {split.after}
    </pre>
  );
}

function statusLabel(status: AgentLoopStatus): string {
  switch (status) {
    case "task_completed":
      return "✅ タスク完了(シミュレーション判定)";
    case "agent_finished":
      return "🏁 Agentが終了を判断しました";
    case "max_turns":
      return "⏱ 最大ターン数に到達しました";
    case "stopped":
      return "■ 停止しました";
    case "error":
      return "⚠ エラーで終了しました";
  }
}

interface Props {
  turns: AgentTurnEvent[];
  // The turn currently streaming in, if any — turn_start has fired but
  // turn_done hasn't yet. Rendered as a live, growing card at the bottom.
  liveTurn: { turn: number; text: string } | null;
  finalStatus: { status: AgentLoopStatus; detail: string | null } | null;
}

export default function AgentTrajectoryView({ turns, liveTurn, finalStatus }: Props) {
  if (turns.length === 0 && !liveTurn && !finalStatus) {
    return (
      <p className="muted agent-trajectory-empty">
        「開始」を押すと、ここにターンごとのやり取り(トラジェクトリ)が表示されます。
      </p>
    );
  }

  return (
    <div className="agent-trajectory">
      {turns.map((turn) => {
        const isLast = turn.turn === turns.length && !liveTurn;
        return (
          <details key={turn.turn} className="agent-turn-card" open={isLast}>
            <summary>
              <span>ターン {turn.turn}</span>
              {turn.taskCompleted !== null && (
                <span className={turn.taskCompleted ? "badge badge-ok" : "badge"}>
                  task_completed: {String(turn.taskCompleted)}
                </span>
              )}
            </summary>
            <div className="agent-turn-body">
              <div className="prompt-turn-label">LLM出力</div>
              <LlmOutput text={turn.llmRaw} />
              {turn.stdout && (
                <>
                  <div className="prompt-turn-label">stdout</div>
                  <pre className="stdout">{turn.stdout}</pre>
                </>
              )}
              {turn.stderr && (
                <>
                  <div className="prompt-turn-label">stderr</div>
                  <pre className="stderr">{turn.stderr}</pre>
                </>
              )}
            </div>
          </details>
        );
      })}

      {liveTurn && (
        <details className="agent-turn-card agent-turn-live" open>
          <summary>
            <span>ターン {liveTurn.turn}(生成中...)</span>
          </summary>
          <div className="agent-turn-body">
            <div className="prompt-turn-label">LLM出力(ストリーミング中)</div>
            <pre className="prompt-text-readonly">{liveTurn.text}</pre>
          </div>
        </details>
      )}

      {finalStatus && (
        <div className={finalStatus.status === "error" ? "agent-final-status error" : "agent-final-status"}>
          <strong>{statusLabel(finalStatus.status)}</strong>
          {finalStatus.detail && <p>{finalStatus.detail}</p>}
        </div>
      )}
    </div>
  );
}
