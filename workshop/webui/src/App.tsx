import { useCallback, useRef, useState } from "react";
import { closeSession, createSession, fetchReplayUrl, resetSession, runCell } from "./api";
import TaskSelect from "./components/TaskSelect";
import CameraView from "./components/CameraView";
import Cell, { type CellState } from "./components/Cell";
import PerceptionPanel from "./components/PerceptionPanel";
import Toolbar from "./components/Toolbar";
import ApiDocsModal from "./components/ApiDocsModal";
import type { PerceptionStep } from "./types";

let cellCounter = 0;
function newCell(code = ""): CellState {
  cellCounter += 1;
  return { id: `cell-${cellCounter}`, code, running: false, result: null, error: null };
}

interface SessionInfo {
  sessionId: string;
  taskId: string;
  taskPrompt: string | null;
  apiDocs: string;
}

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [frames, setFrames] = useState<Record<string, string>>({});
  const [cells, setCells] = useState<CellState[]>([newCell()]);
  const [perceptionSteps, setPerceptionSteps] = useState<PerceptionStep[]>([]);
  const [resetting, setResetting] = useState(false);
  const [savingReplay, setSavingReplay] = useState(false);
  const [docsVisible, setDocsVisible] = useState(false);
  const replayUrlRef = useRef<string | null>(null);

  const handleSelectTask = useCallback(async (taskId: string) => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await createSession(taskId);
      setSession({
        sessionId: res.session_id,
        taskId: res.task_id,
        taskPrompt: res.task_prompt,
        apiDocs: res.api_docs,
      });
      setFrames(res.frames);
      setCells([newCell()]);
      setPerceptionSteps([]);
    } catch (err) {
      setStartError(String(err));
    } finally {
      setStarting(false);
    }
  }, []);

  const updateCell = useCallback((id: string, patch: Partial<CellState>) => {
    setCells((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const handleRunCell = useCallback(
    async (id: string) => {
      if (!session) return;
      const cell = cells.find((c) => c.id === id);
      if (!cell) return;
      updateCell(id, { running: true, error: null });
      try {
        const result = await runCell(session.sessionId, id, cell.code);
        updateCell(id, { running: false, result });
        setFrames(result.frames);
        if (result.perception_steps.length > 0) {
          setPerceptionSteps((prev) => [...prev, ...result.perception_steps]);
        }
      } catch (err) {
        updateCell(id, { running: false, error: String(err) });
      }
    },
    [session, cells, updateCell],
  );

  const handleRunAll = useCallback(async () => {
    for (const cell of cells) {
      await handleRunCell(cell.id);
    }
  }, [cells, handleRunCell]);

  const handleAddCell = useCallback(() => {
    setCells((prev) => [...prev, newCell()]);
  }, []);

  const handleDeleteCell = useCallback((id: string) => {
    setCells((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev));
  }, []);

  const handleReset = useCallback(async () => {
    if (!session) return;
    setResetting(true);
    try {
      const res = await resetSession(session.sessionId);
      setFrames(res.frames);
      setCells([newCell()]);
      setPerceptionSteps([]);
      setSession((prev) => (prev ? { ...prev, apiDocs: res.api_docs, taskPrompt: res.task_prompt } : prev));
    } finally {
      setResetting(false);
    }
  }, [session]);

  const handleSaveReplay = useCallback(async () => {
    if (!session) return;
    // Open the tab synchronously, inside the click's user-gesture chain —
    // opening it only after the `await` below lets popup blockers silently
    // swallow it, since by then it's no longer seen as gesture-triggered.
    const popup = window.open("", "_blank");
    setSavingReplay(true);
    try {
      if (replayUrlRef.current) URL.revokeObjectURL(replayUrlRef.current);
      const url = await fetchReplayUrl(session.sessionId);
      replayUrlRef.current = url;
      if (popup) {
        popup.location.href = url;
      } else {
        // Popup blocked even for the synchronous open; fall back to same-tab navigation.
        window.location.href = url;
      }
    } catch (err) {
      popup?.close();
      alert(`リプレイ動画の取得に失敗しました: ${err}`);
    } finally {
      setSavingReplay(false);
    }
  }, [session]);

  const handleEndSession = useCallback(async () => {
    if (!session) return;
    await closeSession(session.sessionId).catch(() => {});
    setSession(null);
    setFrames({});
    setCells([newCell()]);
    setPerceptionSteps([]);
  }, [session]);

  if (!session) {
    return (
      <div className="app">
        <TaskSelect onSelect={handleSelectTask} busy={starting} />
        {starting && <p className="status">環境を起動しています...(初回はモデルのロードに時間がかかります)</p>}
        {startError && <p className="error">セッション開始に失敗しました: {startError}</p>}
      </div>
    );
  }

  return (
    <div className="app session-screen">
      <Toolbar
        taskId={session.taskId}
        onBackToMain={handleEndSession}
        onReset={handleReset}
        onSaveReplay={handleSaveReplay}
        onEndSession={handleEndSession}
        onShowDocs={() => setDocsVisible(true)}
        resetting={resetting}
        savingReplay={savingReplay}
      />
      <ApiDocsModal visible={docsVisible} docs={session.apiDocs} onClose={() => setDocsVisible(false)} />
      {session.taskPrompt && <p className="task-prompt">{session.taskPrompt}</p>}
      <div className="main-panes">
        <div className="pane pane-camera">
          <CameraView frames={frames} />
        </div>
        <div className="pane pane-editor">
          {cells.map((cell, i) => (
            <Cell
              key={cell.id}
              index={i}
              cell={cell}
              onChange={(code) => updateCell(cell.id, { code })}
              onRun={() => handleRunCell(cell.id)}
              onDelete={() => handleDeleteCell(cell.id)}
              canDelete={cells.length > 1}
            />
          ))}
          <div className="cell-actions">
            <button onClick={handleAddCell}>+ セル追加</button>
            <button onClick={handleRunAll}>Run All</button>
          </div>
        </div>
        <div className="pane pane-perception">
          <PerceptionPanel steps={perceptionSteps} />
        </div>
      </div>
    </div>
  );
}
