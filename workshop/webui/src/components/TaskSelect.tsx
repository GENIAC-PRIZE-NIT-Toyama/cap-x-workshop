import { useEffect, useState } from "react";
import { listEvalSuites, listTasks, type EvalSuite } from "../api";
import { listNotebooks, deleteNotebook, type Notebook, type NotebookMode } from "../notebooks";
import type { TaskSummary } from "../types";

interface Props {
  onStartNew: (taskId: string, name: string, mode: NotebookMode, suiteId?: string) => void;
  onOpenNotebook: (notebook: Notebook) => void;
  busy: boolean;
}

function TaskGrid({
  tasks,
  busy,
  name,
  mode,
  onStartNew,
}: {
  tasks: TaskSummary[];
  busy: boolean;
  name: string;
  mode: NotebookMode;
  onStartNew: (taskId: string, name: string, mode: NotebookMode) => void;
}) {
  return (
    <div className="task-grid">
      {tasks.map((task) => (
        <button
          key={task.task_id}
          className="task-card"
          disabled={busy}
          onClick={() => onStartNew(task.task_id, name.trim() || task.name, mode)}
        >
          <h2>{task.name}</h2>
          <p>{task.description}</p>
        </button>
      ))}
    </div>
  );
}

const shortName = (n: string) => n.replace(/^LIBERO: /, "").replace(/ into Basket.*$/, "");

function notebookMeta(nb: Notebook, taskName: string): string {
  const count =
    nb.mode === "prompt"
      ? `${nb.experiments?.length ?? 0}実験`
      : nb.mode === "agent"
        ? `${nb.agentResult?.turns.length ?? 0}ターン`
        : `${nb.cells.length}セル`;
  const modeLabel = nb.mode === "prompt" ? "プロンプト" : nb.mode === "agent" ? "Agent" : "手動";
  return `${taskName} ・ ${modeLabel} ・ ${new Date(nb.updatedAt).toLocaleString()} ・ ${count}`;
}

export default function TaskSelect({ onStartNew, onOpenNotebook, busy }: Props) {
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [name, setName] = useState("");
  const [notebooks, setNotebooks] = useState<Notebook[]>(() => listNotebooks());
  const [mode, setMode] = useState<NotebookMode>(() => {
    const saved = localStorage.getItem("defaultNotebookMode") as NotebookMode | null;
    if (saved === "prompt" || saved === "manual" || saved === "agent") return saved;
    return listNotebooks()[0]?.mode ?? "manual";
  });

  useEffect(() => {
    localStorage.setItem("defaultNotebookMode", mode);
  }, [mode]);

  useEffect(() => {
    listEvalSuites()
      .then((res) => setSuites(res.suites))
      .catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    listTasks()
      .then((res) => setTasks(res.tasks))
      .catch((err) => setError(String(err)));
  }, []);

  const taskName = (taskId: string) => tasks?.find((t) => t.task_id === taskId)?.name ?? taskId;

  const handleDelete = (id: string) => {
    deleteNotebook(id);
    setNotebooks(listNotebooks());
  };


  return (
    <div className="task-select">
      <h1>CaP-X Workshop</h1>
      <p className="subtitle">
        タスクを選んでセッションを開始してください。使用できるAPIはどのタスクでも共通です。
      </p>

      {notebooks.length > 0 && (
        <div className="notebook-list">
          <h2>保存済みノートブック</h2>
          {notebooks.map((nb) => (
            <div key={nb.id} className="notebook-row">
              <div className="notebook-row-info">
                <span className="notebook-row-name">{nb.name}</span>
                <span className="notebook-row-meta">{notebookMeta(nb, taskName(nb.taskId))}</span>
              </div>
              <div className="notebook-row-actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    localStorage.setItem("defaultNotebookMode", nb.mode);
                    onOpenNotebook(nb);
                  }}
                >
                  開く
                </button>
                <button disabled={busy} className="danger" onClick={() => handleDelete(nb.id)}>
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="notebook-name-field">
        <label htmlFor="notebook-name">新規ノートブック名(任意)</label>
        <input
          id="notebook-name"
          type="text"
          placeholder="例: 実験1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="mode-select" role="radiogroup" aria-label="ノートブックモード">
        <button
          type="button"
          className={mode === "manual" ? "mode-btn active" : "mode-btn"}
          aria-pressed={mode === "manual"}
          disabled={busy}
          onClick={() => setMode("manual")}
        >
          手動モード
          <small>Perception/Control Primitiveを自分で組み合わせる</small>
        </button>
        <button
          type="button"
          className={mode === "prompt" ? "mode-btn active" : "mode-btn"}
          aria-pressed={mode === "prompt"}
          disabled={busy}
          onClick={() => setMode("prompt")}
        >
          プロンプトモード
          <small>LLMにプロンプトを与えてコードを生成させる</small>
        </button>
        <button
          type="button"
          className={mode === "agent" ? "mode-btn active" : "mode-btn"}
          aria-pressed={mode === "agent"}
          disabled={busy}
          onClick={() => setMode("agent")}
        >
          Agentモード
          <small>System/Feedback Promptを設計し、LLMに試行錯誤(ReAct)させる</small>
        </button>
      </div>

      {error && <p className="error">タスク一覧の取得に失敗しました: {error}</p>}
      {!tasks && !error && <p>読み込み中...</p>}

      {mode === "agent" ? (
        <>
          <h2 className="task-section-title">スイートを選択</h2>
          <p className="muted">
            Agentモードでは、1つのプロンプトを複数タスクに試す「汎化テスト」ができます。まずスイートを選んでください。
          </p>
          {suites.length === 0 && !error && <p>読み込み中...</p>}
          <div className="task-grid">
            {suites.map((suite) => (
              <button
                key={suite.suite_id}
                className="task-card"
                disabled={busy}
                onClick={() => onStartNew(suite.default_task_ids[0], name.trim() || suite.name, "agent", suite.suite_id)}
              >
                <h2>{suite.name}</h2>
                <p>{suite.description}</p>
                <p className="muted">{suite.tasks.map((t) => shortName(t.name)).join(" / ")}</p>
              </button>
            ))}
          </div>
        </>
      ) : (
        tasks &&
        tasks.length > 0 && (
          <>
            <h2 className="task-section-title">タスクを選択</h2>
            <TaskGrid tasks={tasks} busy={busy} name={name} mode={mode} onStartNew={onStartNew} />
          </>
        )
      )}
    </div>
  );
}
