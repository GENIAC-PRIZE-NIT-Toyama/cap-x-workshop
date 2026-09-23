interface Props {
  running: boolean;
  currentTurn: number;
  maxTurns: number;
  onStart: () => void;
  onStop: () => void;
  disabled: boolean;
}

export default function AgentRunControls({ running, currentTurn, maxTurns, onStart, onStop, disabled }: Props) {
  return (
    <div className="agent-run-controls">
      {running ? (
        <button className="stop-btn" onClick={onStop} type="button">
          ■ 停止
        </button>
      ) : (
        <button className="run-btn" onClick={onStart} disabled={disabled} type="button">
          ▶ Agent Loop 開始
        </button>
      )}
      <span className="agent-run-status">
        {running ? `実行中… ターン ${currentTurn} / ${maxTurns}` : "停止中"}
      </span>
    </div>
  );
}
