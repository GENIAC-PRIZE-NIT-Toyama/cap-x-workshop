import type { AgentTurnEvent, AgentLoopStatus } from "../notebooks";
import type { PerceptionStep } from "../types";

// Finds the *last* fenced code block in `text` (mirrors code_extract.py's
// extract_last_code_block()) and splits the string around it. Used for two
// things: (1) rendering the code block as its own, separately-styled
// segment, and (2) deriving the "generated text" bubble as everything
// *except* that block (WORKSHOP request: "生成文(最後のコードブロックだけ
// 取り除いたもの)") — narrative = before + after, code = block's inner body
// with the fences stripped.
function splitLastCodeBlock(text: string): { before: string; code: string; after: string } | null {
  const matches = [...text.matchAll(/```[a-zA-Z0-9]*\n([\s\S]*?)```/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const start = last.index ?? 0;
  const end = start + last[0].length;
  return { before: text.slice(0, start), code: last[1].trim(), after: text.slice(end) };
}

function ImageRow({ frames }: { frames: Record<string, string> | null }) {
  if (!frames || Object.keys(frames).length === 0) return null;
  return (
    <div className="agent-chat-images">
      {Object.entries(frames).map(([camera, image]) => (
        <div key={camera} className="agent-chat-image-wrap">
          <img src={`data:image/jpeg;base64,${image}`} alt={camera} />
          <span className="agent-chat-image-label">{camera}</span>
        </div>
      ))}
    </div>
  );
}

// Perception results as images only, laid out like the input images, each
// captioned underneath with what it is looking at: the API call that
// triggered it (e.g. get_object_pose("red_cube")) plus the perception step
// (and camera, when the step says which).
const OBJECT_APIS = new Set(["get_object_pose", "sample_grasp_pose"]);
const OTHER_APIS = new Set(["goto_pose", "home_pose", "open_gripper", "close_gripper", "get_observation"]);

function PerceptionSteps({ steps }: { steps: PerceptionStep[] }) {
  const items: { img: string; call: string | null; label: string }[] = [];
  let call: string | null = null;
  for (const step of steps) {
    if (OBJECT_APIS.has(step.tool_name)) {
      const name = step.text.match(/'([^']+)'/)?.[1];
      call = name ? `${step.tool_name}("${name}")` : step.tool_name;
    } else if (OTHER_APIS.has(step.tool_name)) {
      call = null;
    }
    const camera = step.text.match(/ in (\S+) view/)?.[1];
    const base = camera ? `${step.tool_name} (${camera})` : step.tool_name;
    step.images.forEach((img, j) => {
      items.push({
        img,
        call: OBJECT_APIS.has(step.tool_name) ? null : call,
        label: step.images.length > 1 ? `${base} (${j + 1}/${step.images.length})` : base,
      });
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="agent-chat-perception">
      <div className="agent-chat-subhead">Perception</div>
      <div className="agent-chat-images agent-perception-images">
        {items.map((it, i) => (
          <div key={i} className="agent-chat-image-wrap">
            <img src={`data:image/jpeg;base64,${it.img}`} alt={it.label} />
            {it.call && <span className="agent-chat-image-label">{it.call}</span>}
            <span className="agent-chat-image-label">{it.label}</span>
          </div>
        ))}
      </div>
    </div>
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
  // turn_done hasn't yet.
  liveTurn: {
    turn: number;
    inputText: string;
    inputFrames: Record<string, string> | null;
    text: string;
    phase: "generating" | "executing";
  } | null;
  finalStatus: { status: AgentLoopStatus; detail: string | null } | null;
}

// One turn = one exchange: a "user" bubble (what was actually sent to the
// LLM — the rendered prompt text, plus the image attached to it if vision
// is on) followed by an "assistant" bubble (the model's narrative text with
// its trailing code block pulled out and shown separately, then the
// execution result and any Perception steps that run produced). Nothing
// here collapses behind a <details> — read top to bottom like a chat log.
export default function AgentTrajectoryView({ turns, liveTurn, finalStatus }: Props) {
  if (turns.length === 0 && !liveTurn && !finalStatus) {
    return (
      <p className="muted agent-trajectory-empty">
        「開始」を押すと、ここにターンごとのやり取り(トラジェクトリ)が表示されます。
      </p>
    );
  }

  return (
    <div className="agent-chat">
      {turns.map((turn) => {
        const split = splitLastCodeBlock(turn.llmRaw);
        const narrative = split ? `${split.before}${split.after}`.trim() : turn.llmRaw;
        return (
          <div key={turn.turn} className="agent-chat-turn">
            <div className="agent-chat-turn-label">ターン {turn.turn}</div>

            <div className="agent-chat-bubble agent-chat-bubble-user">
              <div className="agent-chat-bubble-role">入力</div>
              <pre className="agent-chat-text">{turn.inputText}</pre>
              <ImageRow frames={turn.inputFrames} />
            </div>

            <div className="agent-chat-bubble agent-chat-bubble-assistant">
              <div className="agent-chat-bubble-role">生成</div>
              {narrative && <pre className="agent-chat-text">{narrative}</pre>}
              {split && <pre className="agent-chat-code">{split.code}</pre>}
            </div>

            {turn.code !== null && (
              <div className="agent-chat-bubble agent-chat-bubble-result">
                <div className="agent-chat-bubble-role">
                  実行結果
                  {turn.taskCompleted !== null && (
                    <span className={turn.taskCompleted ? "badge badge-ok" : "badge"}>
                      task_completed: {String(turn.taskCompleted)}
                    </span>
                  )}
                </div>
                {turn.stdout && <pre className="stdout">{turn.stdout}</pre>}
                {turn.stderr && <pre className="stderr">{turn.stderr}</pre>}
                {!turn.stdout && !turn.stderr && <p className="muted">(出力なし)</p>}
                <PerceptionSteps steps={turn.perceptionSteps ?? []} />
              </div>
            )}
          </div>
        );
      })}

      {liveTurn && (
        <div className="agent-chat-turn">
          <div className="agent-chat-turn-label">ターン {liveTurn.turn}({liveTurn.phase === "executing" ? "コード実行中..." : "生成中..."})</div>

          <div className="agent-chat-bubble agent-chat-bubble-user">
            <div className="agent-chat-bubble-role">入力</div>
            <pre className="agent-chat-text">{liveTurn.inputText}</pre>
            <ImageRow frames={liveTurn.inputFrames} />
          </div>

          <div className="agent-chat-bubble agent-chat-bubble-assistant">
            <div className="agent-chat-bubble-role">{liveTurn.phase === "executing" ? "生成(完了)" : "生成(ストリーミング中...)"}</div>
            {(() => {
              const split = splitLastCodeBlock(liveTurn.text);
              if (!split) return <pre className="agent-chat-text">{liveTurn.text}</pre>;
              const narrative = `${split.before}${split.after}`.trim();
              return (
                <>
                  {narrative && <pre className="agent-chat-text">{narrative}</pre>}
                  <pre className="agent-chat-code">{split.code}</pre>
                </>
              );
            })()}
          </div>

          {liveTurn.phase === "executing" && (
            <div className="agent-chat-bubble agent-chat-bubble-result">
              <div className="agent-chat-bubble-role">実行結果</div>
              <p className="muted">⏳ コード実行中...(Perception・ロボット動作の完了を待っています)</p>
            </div>
          )}
        </div>
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
