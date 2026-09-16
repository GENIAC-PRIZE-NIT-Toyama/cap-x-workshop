import { useCallback, useEffect, useRef, useState } from "react";
import { closeSession, createSession, fetchReplayUrl, resetSession, runCell, streamUrl } from "./api";
import TaskSelect from "./components/TaskSelect";
import CameraView from "./components/CameraView";
import Cell, { type CellState } from "./components/Cell";
import PerceptionPanel from "./components/PerceptionPanel";
import Toolbar from "./components/Toolbar";
import ApiDocsModal from "./components/ApiDocsModal";
import { newNotebookId, saveNotebook, type Notebook } from "./notebooks";
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

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null;
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const [frames, setFrames] = useState<Record<string, string>>({});
  const [cells, setCells] = useState<CellState[]>([newCell()]);
  const [perceptionSteps, setPerceptionSteps] = useState<PerceptionStep[]>([]);
  const [resetting, setResetting] = useState(false);
  const [savingReplay, setSavingReplay] = useState(false);
  const [docsVisible, setDocsVisible] = useState(false);
  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [notebookName, setNotebookName] = useState("");
  const replayUrlRef = useRef<string | null>(null);
  const activeRunFramesRef = useRef<{ camera: string; image: string }[]>([]);
  const isCellRunningRef = useRef(false);
  const [replayFrames, setReplayFrames] = useState<{ camera: string; image: string }[]>([]);
  const [activeCamera, setActiveCamera] = useState<string>("robot0_robotview");

  // Live camera feed: pushes every newly-recorded frame — including
  // mid-motion ones — while a cell is running, not just the single
  // before/after snapshot the cell's own HTTP response carries.
  useEffect(() => {
    if (!session) return;
    const ws = new WebSocket(streamUrl(session.sessionId));
    ws.onmessage = (event) => {
      // {"camera": "...", "image": "<base64>"} — the camera key varies per
      // task (e.g. nut_assembly uses "birdview", two_arm_handover uses
      // "agentview"), so it must come from the message, never be assumed.
      const data = JSON.parse(event.data as string) as { camera: string; image: string };
      setFrames((prev) => ({ ...prev, [data.camera]: data.image }));

      if (isCellRunningRef.current) {
        activeRunFramesRef.current.push(data);
      }
    };
    return () => ws.close();
  }, [session?.sessionId]);

  const handleStartNew = useCallback(async (taskId: string, name: string) => {
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
      const id = newNotebookId();
      setNotebookId(id);
      setNotebookName(name);
      saveNotebook({ id, name, taskId, cells: [""], updatedAt: new Date().toISOString() });
    } catch (err) {
      setStartError(String(err));
    } finally {
      setStarting(false);
    }
  }, []);

  const handleOpenNotebook = useCallback(async (notebook: Notebook) => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await createSession(notebook.taskId);
      setSession({
        sessionId: res.session_id,
        taskId: res.task_id,
        taskPrompt: res.task_prompt,
        apiDocs: res.api_docs,
      });
      setFrames(res.frames);
      setCells(notebook.cells.length > 0 ? notebook.cells.map((code) => newCell(code)) : [newCell()]);
      setPerceptionSteps([]);
      setNotebookId(notebook.id);
      setNotebookName(notebook.name);
    } catch (err) {
      setStartError(String(err));
    } finally {
      setStarting(false);
    }
  }, []);

  // Auto-save the notebook's code (not results) to the browser as it's
  // edited, debounced so typing doesn't hit localStorage on every keystroke.
  useEffect(() => {
    if (!notebookId || !session) return;
    const timeout = setTimeout(() => {
      saveNotebook({
        id: notebookId,
        name: notebookName,
        taskId: session.taskId,
        cells: cells.map((c) => c.code),
        updatedAt: new Date().toISOString(),
      });
    }, 500);
    return () => clearTimeout(timeout);
  }, [cells, notebookId, notebookName, session]);

  const updateCell = useCallback((id: string, patch: Partial<CellState>) => {
    setCells((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const handleRunCell = useCallback(
    async (id: string) => {
      if (!session) return;
      const cell = cells.find((c) => c.id === id);
      if (!cell) return;
      updateCell(id, { running: true, error: null });
      setActiveCamera(replayFrames.length > 0 ? replayFrames[0].camera : "robot0_robotview");

      activeRunFramesRef.current = [];
      isCellRunningRef.current = true;

      try {
        const result = await runCell(session.sessionId, id, cell.code);
        isCellRunningRef.current = false;
        updateCell(id, { running: false, result });

        if (result.perception_steps.length > 0) {
          setPerceptionSteps((prev) => [...prev, ...result.perception_steps]);
        }

        setFrames(result.frames);
        if (activeRunFramesRef.current.length > 0) {
          setReplayFrames([...activeRunFramesRef.current]);
          setActiveCamera("replay");
        }
      } catch (err) {
        isCellRunningRef.current = false;
        updateCell(id, { running: false, error: String(err) });
      }
    },
    [session, cells, updateCell, replayFrames],
  );

  const handleRunAll = useCallback(async () => {
    for (const cell of cells) {
      await handleRunCell(cell.id);
    }
  }, [cells, handleRunCell]);

  const handleAddCell = useCallback((index?: number) => {
    setCells((prev) => {
      const next = [...prev];
      next.splice(index ?? next.length, 0, newCell());
      return next;
    });
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
      // Keep the written code — only the environment and each cell's stale
      // (pre-reset) run result get cleared, not the notebook itself.
      setCells((prev) => prev.map((c) => ({ ...c, result: null, error: null })));
      setPerceptionSteps([]);
      setSession((prev) => (prev ? { ...prev, apiDocs: res.api_docs, taskPrompt: res.task_prompt } : prev));
    } finally {
      setResetting(false);
    }
  }, [session]);

  const handleResetAndRunAll = useCallback(async () => {
    await handleReset();
    await handleRunAll();
  }, [handleReset, handleRunAll]);

  const handleResetAndRunCell = useCallback(
    async (id: string) => {
      await handleReset();
      await handleRunCell(id);
    },
    [handleReset, handleRunCell],
  );

  const handleResetAndRunUpTo = useCallback(
    async (targetIndex: number) => {
      await handleReset();
      for (let i = 0; i <= targetIndex; i++) {
        await handleRunCell(cells[i].id);
      }
    },
    [cells, handleReset, handleRunCell],
  );

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
    setNotebookId(null);
    setNotebookName("");
  }, [session]);

  if (!session) {
    return (
      <div className="app">
        <TaskSelect onStartNew={handleStartNew} onOpenNotebook={handleOpenNotebook} busy={starting} />
        {starting && <p className="status">環境を起動しています...(初回はモデルのロードに時間がかかります)</p>}
        {startError && <p className="error">セッション開始に失敗しました: {startError}</p>}
      </div>
    );
  }

  return (
    <div className="app session-screen">
      <Toolbar
        taskId={session.taskId}
        notebookName={notebookName}
        theme={theme}
        onToggleTheme={toggleTheme}
        onBackToMain={handleEndSession}
        onReset={handleReset}
        onSaveReplay={handleSaveReplay}
        onEndSession={handleEndSession}
        onShowDocs={() => setDocsVisible(true)}
        resetting={resetting}
        savingReplay={savingReplay}
      />
      <ApiDocsModal visible={docsVisible} docs={session.apiDocs} theme={theme} onClose={() => setDocsVisible(false)} />
      {session.taskPrompt && <p className="task-prompt">{session.taskPrompt}</p>}
      <div className="main-panes">
        <div className="pane pane-camera">
          <CameraView frames={frames} replayFrames={replayFrames} activeCamera={activeCamera} onSelectCamera={setActiveCamera} />
        </div>
        <div className="pane pane-editor">
          <div className="editor-header">
            <div>
              <button className="run-btn" style={{marginRight: "8px"}} onClick={handleRunAll} disabled={resetting}>
                ▶ Run All
              </button>
              <button
                className="reset-run-btn"
                onClick={handleResetAndRunAll}
                disabled={resetting}
              >
                {resetting ? "リセット中..." : "環境リセット & Run All"}
              </button>
            </div>
            <span className="editor-title">セル数: {cells.length}</span>
          </div>
          <div className="cell-divider">
            <button onClick={() => handleAddCell(0)}>+ コード</button>
          </div>
          {cells.map((cell, i) => (
            <div key={cell.id} className="cell-wrapper">
              <Cell
                index={i}
                cell={cell}
                theme={theme}
                onChange={(code) => updateCell(cell.id, { code })}
                onRun={() => handleRunCell(cell.id)}
                onResetAndRun={() => handleResetAndRunCell(cell.id)}
                onResetAndRunUpTo={() => handleResetAndRunUpTo(i)}
                onDelete={() => handleDeleteCell(cell.id)}
                canDelete={cells.length > 1}
                resetting={resetting}
              />
              <div className="cell-divider">
                <button onClick={() => handleAddCell(i + 1)}>+ コード</button>
              </div>
            </div>
          ))}
        </div>
        <div className="pane pane-perception">
          <PerceptionPanel steps={perceptionSteps} />
        </div>
      </div>
    </div>
  );
}
