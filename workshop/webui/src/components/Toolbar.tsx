interface Props {
  taskId: string;
  notebookName: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
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
  notebookName,
  theme,
  onToggleTheme,
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
        <span className="toolbar-task">
          {notebookName || "Untitled"} <span className="toolbar-task-id">({taskId})</span>
        </span>
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
        <button className="theme-toggle-btn" onClick={onToggleTheme} title={theme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"}>
          {theme === "dark" ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
