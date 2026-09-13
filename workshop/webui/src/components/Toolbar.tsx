interface Props {
  taskId: string;
  onBackToMain: () => void;
  onReset: () => void;
  onSaveReplay: () => void;
  onEndSession: () => void;
  onShowDocs: () => void;
  resetting: boolean;
  savingReplay: boolean;
}

export default function Toolbar({
  taskId,
  onBackToMain,
  onReset,
  onSaveReplay,
  onEndSession,
  onShowDocs,
  resetting,
  savingReplay,
}: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button className="back-btn" onClick={onBackToMain}>
          ← タスク選択に戻る
        </button>
        <span className="toolbar-task">Task: {taskId}</span>
      </div>
      <div className="toolbar-actions">
        <button onClick={onShowDocs}>利用可能なAPI</button>
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
