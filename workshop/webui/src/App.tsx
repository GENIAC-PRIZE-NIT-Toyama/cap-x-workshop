import { useCallback, useEffect, useRef, useState } from "react";
import { useMonaco } from "@monaco-editor/react";
import { parseApiDocs } from "./apiDocs";
import {
  type ChatMessage,
  closeSession,
  createSession,
  fetchReplayUrl,
  resetSession,
  runCell,
  streamGenerate,
  streamUrl,
} from "./api";
import TaskSelect from "./components/TaskSelect";
import CameraView from "./components/CameraView";
import Cell, { type CellState } from "./components/Cell";
import PerceptionPanel from "./components/PerceptionPanel";
import Toolbar from "./components/Toolbar";
import ApiDocsModal from "./components/ApiDocsModal";
import TaskPromptBanner, { type PromptLang } from "./components/TaskPromptBanner";
import PromptExperimentPanel, {
  newExperimentUiState,
  type ExperimentUiState,
  type TurnRunState,
} from "./components/PromptExperimentPanel";
import {
  newNotebookId,
  saveNotebook,
  type GenerationSettings,
  type Notebook,
  type NotebookMode,
  type PromptExperiment,
  type PromptTurn,
} from "./notebooks";
import type { PerceptionStep } from "./types";

let cellCounter = 0;
function newCell(code = ""): CellState {
  cellCounter += 1;
  return { id: `cell-${cellCounter}`, code, running: false, result: null, error: null };
}

const DEFAULT_SETTINGS: GenerationSettings = { temperature: 0.7 };

let experimentCounter = 0;
function newTurn(userText = "", settings: GenerationSettings = DEFAULT_SETTINGS): PromptTurn {
  return { userText, settings, llmRawResponse: "", extractedCode: "" };
}
// New experiments start with a blank prompt on purpose — participants build
// it themselves from scratch (that's the point of the exercise). The task
// instruction and API docs are still one click away (the task-prompt banner
// and the ApiDocsModal), just not auto-inserted into the editable text.
function newExperiment(initialUserText = ""): PromptExperiment {
  experimentCounter += 1;
  return { id: `exp-${experimentCounter}`, turns: [newTurn(initialUserText)] };
}

interface SessionInfo {
  sessionId: string;
  taskId: string;
  taskPrompt: string | null;
  taskPromptJa: string | null;
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

  const [promptLang, setPromptLang] = useState<PromptLang>(
    () => (localStorage.getItem("promptLang") === "en" ? "en" : "ja"),
  );

  useEffect(() => {
    localStorage.setItem("promptLang", promptLang);
  }, [promptLang]);

  // Offer the session's API functions (parsed from api_docs) as completions
  // in every code cell. Registered once per session at the language level,
  // not per Cell, so the candidates aren't duplicated.
  const monaco = useMonaco();
  const apiDocs = session?.apiDocs;
  useEffect(() => {
    if (!monaco || apiDocs === undefined) return;
    const functions = parseApiDocs(apiDocs);
    const apiNames = new Set(functions.map((f) => f.name));
    const disposable = monaco.languages.registerCompletionItemProvider("python", {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const api = functions.map((f) => ({
          label: f.name,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: f.name,
          detail: f.signature,
          documentation: f.doc,
          range,
        }));
        // Monaco drops its built-in word-based suggestions as soon as any
        // provider returns results, so re-create them here: every word in
        // every python model (same as its "matchingDocuments" default),
        // minus API names and the word being typed.
        const words = new Set<string>();
        for (const m of monaco.editor.getModels()) {
          if (m.getLanguageId() !== "python") continue;
          for (const w of m.getValue().match(/[A-Za-z_]\w*/g) ?? []) {
            if (!apiNames.has(w) && w !== word.word) words.add(w);
          }
        }
        const text = [...words].map((w) => ({
          label: w,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: w,
          range,
        }));
        return { suggestions: [...api, ...text] };
      },
    });
    return () => disposable.dispose();
  }, [monaco, apiDocs]);

  const [frames, setFrames] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<NotebookMode>("manual");
  const [cells, setCells] = useState<CellState[]>([newCell()]);
  const [experiments, setExperiments] = useState<PromptExperiment[]>([]);
  const [expUi, setExpUi] = useState<Record<string, ExperimentUiState>>({});
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
    const url = streamUrl(session.sessionId);
    const ws = new WebSocket(url);
    ws.onmessage = (event) => {
      // {"camera": "...", "image": "<base64>"} — the camera key varies per
      // task (e.g. nut_assembly uses "birdview", two_arm_handover uses
      // "agentview"), so it must come from the message, never be assumed.
      const data = JSON.parse(event.data as string) as { camera: string; image: string };
      setFrames((prev) => ({ ...prev, [data.camera]: data.image }));

      if (isCellRunningRef.current) {
        const prev = activeRunFramesRef.current[activeRunFramesRef.current.length - 1];
        if (!prev || prev.image !== data.image) {
          activeRunFramesRef.current.push(data);
        }
      }
    };
    return () => ws.close();
  }, [session?.sessionId]);

  const handleStartNew = useCallback(async (taskId: string, name: string, notebookMode: NotebookMode) => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await createSession(taskId);
      setSession({
        sessionId: res.session_id,
        taskId: res.task_id,
        taskPrompt: res.task_prompt,
        taskPromptJa: res.task_prompt_ja,
        apiDocs: res.api_docs,
      });
      setFrames(res.frames);
      setMode(notebookMode);
      setPerceptionSteps([]);
      activeRunFramesRef.current = [];
      setReplayFrames([]);
      const id = newNotebookId();
      setNotebookId(id);
      setNotebookName(name);

      if (notebookMode === "prompt") {
        const exp = newExperiment();
        setCells([newCell()]);
        setExperiments([exp]);
        setExpUi({ [exp.id]: newExperimentUiState() });
        saveNotebook({
          id,
          name,
          taskId,
          mode: "prompt",
          cells: [],
          experiments: [exp],
          updatedAt: new Date().toISOString(),
        });
      } else {
        setCells([newCell()]);
        setExperiments([]);
        setExpUi({});
        saveNotebook({ id, name, taskId, mode: "manual", cells: [""], updatedAt: new Date().toISOString() });
      }
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
        taskPromptJa: res.task_prompt_ja,
        apiDocs: res.api_docs,
      });
      setFrames(res.frames);
      setMode(notebook.mode);
      setPerceptionSteps([]);
      activeRunFramesRef.current = [];
      setReplayFrames([]);
      setNotebookId(notebook.id);
      setNotebookName(notebook.name);

      if (notebook.mode === "prompt") {
        const exps =
          notebook.experiments && notebook.experiments.length > 0
            ? notebook.experiments
            : [newExperiment()];
        setExperiments(exps);
        setExpUi(Object.fromEntries(exps.map((e) => [e.id, newExperimentUiState()])));
        setCells([newCell()]);
      } else {
        setCells(notebook.cells.length > 0 ? notebook.cells.map((code) => newCell(code)) : [newCell()]);
        setExperiments([]);
        setExpUi({});
      }
    } catch (err) {
      setStartError(String(err));
    } finally {
      setStarting(false);
    }
  }, []);

  // Auto-save the notebook to the browser as it's edited, debounced so
  // typing doesn't hit localStorage on every keystroke. Manual-mode
  // notebooks persist code only (unchanged); prompt-mode notebooks persist
  // prompts/LLM responses/code/stdout-stderr per notebooks.ts's Notebook
  // shape — never frames/video/perception_steps.
  useEffect(() => {
    if (!notebookId || !session) return;
    const timeout = setTimeout(() => {
      saveNotebook({
        id: notebookId,
        name: notebookName,
        taskId: session.taskId,
        mode,
        cells: mode === "manual" ? cells.map((c) => c.code) : [],
        experiments: mode === "prompt" ? experiments : undefined,
        updatedAt: new Date().toISOString(),
      });
    }, 500);
    return () => clearTimeout(timeout);
  }, [cells, experiments, mode, notebookId, notebookName, session]);

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

      isCellRunningRef.current = true;

      try {
        const result = await runCell(session.sessionId, id, cell.code);
        await new Promise((resolve) => setTimeout(resolve, 250));
        isCellRunningRef.current = false;
        updateCell(id, { running: false, result });

        if (result.perception_steps.length > 0) {
          setPerceptionSteps((prev) => [...prev, ...result.perception_steps]);
        }

        setFrames(result.frames);
        if (result.frames && Object.keys(result.frames).length > 0) {
          const cam = Object.keys(result.frames)[0];
          const lastImg = result.frames[cam];
          const prev = activeRunFramesRef.current[activeRunFramesRef.current.length - 1];
          if (!prev || prev.image !== lastImg) {
            activeRunFramesRef.current.push({ camera: cam, image: lastImg });
          }
        }
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
      activeRunFramesRef.current = [];
      setReplayFrames([]);
      setActiveCamera("robot0_robotview");
      const res = await resetSession(session.sessionId);
      setFrames(res.frames);
      // Keep the written code — only the environment and each cell's stale
      // (pre-reset) run result get cleared, not the notebook itself.
      setCells((prev) => prev.map((c) => ({ ...c, result: null, error: null })));
      setPerceptionSteps([]);
      setSession((prev) =>
        prev ? { ...prev, apiDocs: res.api_docs, taskPrompt: res.task_prompt, taskPromptJa: res.task_prompt_ja } : prev,
      );
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

  // ------------------------------------------------------------------
  // Prompt-engineering mode: experiments (1 prompt + 1 generated code
  // block per trial, with optional manual Self-Refine turns). Reuses the
  // same /cells/run and /reset endpoints as manual mode's Cell — a
  // generated code block is executed exactly like a hand-written one, just
  // always via a fresh reset (never plain "Run") since experiments are
  // independent of each other and of prior turns' side effects.
  // ------------------------------------------------------------------

  const updateExperiment = useCallback((expId: string, updater: (exp: PromptExperiment) => PromptExperiment) => {
    setExperiments((prev) => prev.map((e) => (e.id === expId ? updater(e) : e)));
  }, []);

  const updateTurn = useCallback(
    (expId: string, turnIndex: number, patch: Partial<PromptTurn>) => {
      updateExperiment(expId, (exp) => ({
        ...exp,
        turns: exp.turns.map((t, i) => (i === turnIndex ? { ...t, ...patch } : t)),
      }));
    },
    [updateExperiment],
  );

  const updateExpUi = useCallback((expId: string, patch: Partial<ExperimentUiState>) => {
    setExpUi((prev) => ({ ...prev, [expId]: { ...(prev[expId] ?? newExperimentUiState()), ...patch } }));
  }, []);

  const updateTurnRunState = useCallback((expId: string, turnIndex: number, patch: Partial<TurnRunState>) => {
    setExpUi((prev) => {
      const cur = prev[expId] ?? newExperimentUiState();
      const curRun: TurnRunState = cur.runStates[turnIndex] ?? { running: false, result: null, error: null };
      return { ...prev, [expId]: { ...cur, runStates: { ...cur.runStates, [turnIndex]: { ...curRun, ...patch } } } };
    });
  }, []);

  const handleAddExperiment = useCallback(() => {
    if (!session) return;
    const exp = newExperiment();
    setExperiments((prev) => [...prev, exp]);
    setExpUi((prev) => ({ ...prev, [exp.id]: newExperimentUiState() }));
  }, [session]);

  const handleDeleteExperiment = useCallback((expId: string) => {
    setExperiments((prev) => (prev.length > 1 ? prev.filter((e) => e.id !== expId) : prev));
    setExpUi((prev) => {
      const next = { ...prev };
      delete next[expId];
      return next;
    });
  }, []);

  const handleGenerate = useCallback(
    async (expId: string) => {
      if (!session) return;
      const exp = experiments.find((e) => e.id === expId);
      if (!exp) return;
      const turnIndex = exp.turns.length - 1;

      // Full conversation so far: each earlier turn's prompt + the model's
      // response to it, then this turn's (freshly edited) prompt — this is
      // what makes Self-Refine "see" everything tried before it.
      const messages: ChatMessage[] = [];
      for (let i = 0; i <= turnIndex; i++) {
        messages.push({ role: "user", content: exp.turns[i].userText });
        if (i < turnIndex) {
          messages.push({ role: "assistant", content: exp.turns[i].llmRawResponse });
        }
      }
      const settings = exp.turns[turnIndex].settings;

      updateExpUi(expId, { generating: true, streamingText: "", genError: null });
      try {
        const { fullText, code } = await streamGenerate(session.sessionId, messages, settings, (delta) => {
          setExpUi((prev) => {
            const cur = prev[expId] ?? newExperimentUiState();
            return { ...prev, [expId]: { ...cur, streamingText: cur.streamingText + delta } };
          });
        });
        updateTurn(expId, turnIndex, { llmRawResponse: fullText, extractedCode: code });
        updateExpUi(expId, { generating: false });
      } catch (err) {
        updateExpUi(expId, { generating: false, genError: String(err) });
      }
    },
    [session, experiments, updateExpUi, updateTurn],
  );

  const handleResetAndRunExperiment = useCallback(
    async (expId: string) => {
      if (!session) return;
      const exp = experiments.find((e) => e.id === expId);
      if (!exp) return;
      const turnIndex = exp.turns.length - 1;
      const turn = exp.turns[turnIndex];
      const cellId = `${expId}-turn-${turnIndex}`;

      updateTurnRunState(expId, turnIndex, { running: true, error: null });
      isCellRunningRef.current = true;
      await handleReset();
      try {
        const result = await runCell(session.sessionId, cellId, turn.extractedCode);
        await new Promise((resolve) => setTimeout(resolve, 250));
        isCellRunningRef.current = false;
        updateTurnRunState(expId, turnIndex, { running: false, result });
        updateTurn(expId, turnIndex, { lastRun: { stdout: result.stdout, stderr: result.stderr } });

        if (result.perception_steps.length > 0) {
          setPerceptionSteps((prev) => [...prev, ...result.perception_steps]);
        }
        setFrames(result.frames);
        if (result.frames && Object.keys(result.frames).length > 0) {
          const cam = Object.keys(result.frames)[0];
          const lastImg = result.frames[cam];
          activeRunFramesRef.current.push({ camera: cam, image: lastImg });
        }
        if (activeRunFramesRef.current.length > 0) {
          setReplayFrames([...activeRunFramesRef.current]);
          setActiveCamera("replay");
        }
      } catch (err) {
        isCellRunningRef.current = false;
        updateTurnRunState(expId, turnIndex, { running: false, error: String(err) });
      }
    },
    [session, experiments, handleReset, updateTurnRunState, updateTurn],
  );

  const handleAddRefineTurn = useCallback((expId: string) => {
    setExperiments((prev) =>
      prev.map((exp) => {
        if (exp.id !== expId) return exp;
        const lastTurn = exp.turns[exp.turns.length - 1];
        const stdout = lastTurn.lastRun?.stdout ?? "";
        const stderr = lastTurn.lastRun?.stderr ?? "";
        const seeded = [
          "直前に実行したコードの標準出力・標準エラー出力は以下の通りです。これを踏まえてコードを修正してください。",
          "",
          "--- stdout ---",
          stdout || "(なし)",
          "",
          "--- stderr ---",
          stderr || "(なし)",
          "",
          "(ここに追加の指示があれば書いてください)",
        ].join("\n");
        return { ...exp, turns: [...exp.turns, newTurn(seeded, { ...lastTurn.settings })] };
      }),
    );
  }, []);

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
    activeRunFramesRef.current = [];
    setReplayFrames([]);
    setSession(null);
    setFrames({});
    setMode("manual");
    setCells([newCell()]);
    setExperiments([]);
    setExpUi({});
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
      {session.taskPrompt && (
        <TaskPromptBanner
          prompt={session.taskPrompt}
          promptJa={session.taskPromptJa}
          lang={promptLang}
          onChangeLang={setPromptLang}
        />
      )}
      <div className="main-panes">
        <div className="pane pane-camera">
          <CameraView frames={frames} replayFrames={replayFrames} activeCamera={activeCamera} onSelectCamera={setActiveCamera} />
        </div>
        <div className="pane pane-editor">
          {mode === "manual" ? (
            <>
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
            </>
          ) : (
            <>
              <div className="editor-header">
                <span className="editor-title">プロンプトエンジニアリングモード</span>
                <span className="editor-title">実験数: {experiments.length}</span>
              </div>
              {experiments.map((exp, expIndex) => (
                <div key={exp.id} className="experiment-wrapper">
                  <PromptExperimentPanel
                    index={expIndex}
                    experiment={exp}
                    ui={expUi[exp.id] ?? newExperimentUiState()}
                    theme={theme}
                    resetting={resetting}
                    onUpdateTurnText={(turnIndex, text) => updateTurn(exp.id, turnIndex, { userText: text })}
                    onUpdateTurnSettings={(turnIndex, settings) => updateTurn(exp.id, turnIndex, { settings })}
                    onUpdateTurnCode={(turnIndex, code) => updateTurn(exp.id, turnIndex, { extractedCode: code })}
                    onGenerate={() => handleGenerate(exp.id)}
                    onResetAndRun={() => handleResetAndRunExperiment(exp.id)}
                    onAddRefineTurn={() => handleAddRefineTurn(exp.id)}
                    onDeleteExperiment={() => handleDeleteExperiment(exp.id)}
                    canDelete={experiments.length > 1}
                  />
                </div>
              ))}
              <div className="experiment-divider">
                <button onClick={handleAddExperiment}>+ 実験を追加</button>
              </div>
            </>
          )}
        </div>
        <div className="pane pane-perception">
          <PerceptionPanel steps={perceptionSteps} />
        </div>
      </div>
    </div>
  );
}
