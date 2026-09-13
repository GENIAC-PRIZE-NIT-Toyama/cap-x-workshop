interface Props {
  taskId: string;
  onReset: () => void;
  onSaveReplay: () => void;
  onEndSession: () => void;
  resetting: boolean;
  savingReplay: boolean;
}

export default function Toolbar({
  taskId,
  onReset,
  onSaveReplay,
  onEndSession,
  resetting,
  savingReplay,
}: Props) {
  return (
    <div className="toolbar">
      <span className="toolbar-task">Task: {taskId}</span>
      <div className="toolbar-actions">
        <button onClick={onReset} disabled={resetting}>
          {resetting ? "リセット中..." : "環境リセット"}
        </button>
        <button onClick={onSaveReplay} disabled={savingReplay}>
          {savingReplay ? "保存中..." : "リプレイ動画を保存"}
        </button>
        <button className="danger" onClick={onEndSession}>
          セッション終了
        </button>
      </div>
    </div>
  );
}
