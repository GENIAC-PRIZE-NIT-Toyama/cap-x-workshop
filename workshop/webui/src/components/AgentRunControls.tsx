interface Props {
  running: boolean;
  stopping: boolean;
  currentTurn: number;
  maxTurns: number;
  onStart: () => void;
  onStop: () => void;
  disabled: boolean;
  onExport: () => void;
  canExport: boolean;
  exporting: boolean;
}

export default function AgentRunControls({ running, stopping, currentTurn, maxTurns, onStart, onStop, disabled, onExport, canExport, exporting }: Props) {
  return (
    <div className="agent-run-controls">
      {running ? (
        <button className="stop-btn" onClick={onStop} disabled={stopping} type="button">
          {stopping ? "停止中..." : "■ 停止"}
        </button>
      ) : (
        <button className="run-btn" onClick={onStart} disabled={disabled} type="button">
          ▶ Agent Loop 開始
        </button>
      )}
      <button type="button" onClick={onExport} disabled={running || !canExport || exporting} title="Trajectory(.txt)とリプレイ動画(.mp4)をダウンロード">
        {exporting ? "Export中..." : "Export"}
      </button>
      <span className="agent-run-status">
        {running ? `実行中… ターン ${currentTurn} / ${maxTurns}` : "停止中"}
      </span>
    </div>
  );
}
