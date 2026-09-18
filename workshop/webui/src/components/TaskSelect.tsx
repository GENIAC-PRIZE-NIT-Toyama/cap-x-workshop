import { useEffect, useState } from "react";
import { listTasks } from "../api";
import { listNotebooks, deleteNotebook, type Notebook, type NotebookMode } from "../notebooks";
import type { TaskSummary } from "../types";

interface Props {
  onStartNew: (taskId: string, name: string, mode: NotebookMode) => void;
  onOpenNotebook: (notebook: Notebook) => void;
  busy: boolean;
}

function TaskGrid({
  tasks,
  busy,
  name,
  mode,
  featured,
  onStartNew,
}: {
  tasks: TaskSummary[];
  busy: boolean;
  name: string;
  mode: NotebookMode;
  featured?: boolean;
  onStartNew: (taskId: string, name: string, mode: NotebookMode) => void;
}) {
  return (
    <div className="task-grid">
      {tasks.map((task) => (
        <button
          key={task.task_id}
          className={featured ? "task-card featured" : "task-card"}
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

function notebookMeta(nb: Notebook, taskName: string): string {
  const count = nb.mode === "prompt" ? `${nb.experiments?.length ?? 0}実験` : `${nb.cells.length}セル`;
  const modeLabel = nb.mode === "prompt" ? "プロンプト" : "手動";
  return `${taskName} ・ ${modeLabel} ・ ${new Date(nb.updatedAt).toLocaleString()} ・ ${count}`;
}

export default function TaskSelect({ onStartNew, onOpenNotebook, busy }: Props) {
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notebooks, setNotebooks] = useState<Notebook[]>(() => listNotebooks());
  const [mode, setMode] = useState<NotebookMode>(() => {
    const saved = localStorage.getItem("defaultNotebookMode") as NotebookMode | null;
    if (saved === "prompt" || saved === "manual") return saved;
    return listNotebooks()[0]?.mode ?? "manual";
  });

  useEffect(() => {
    localStorage.setItem("defaultNotebookMode", mode);
  }, [mode]);

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

  const featuredTasks = tasks?.filter((t) => t.featured) ?? [];
  const otherTasks = tasks?.filter((t) => !t.featured) ?? [];

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
      </div>

      {error && <p className="error">タスク一覧の取得に失敗しました: {error}</p>}
      {!tasks && !error && <p>読み込み中...</p>}

      {featuredTasks.length > 0 && (
        <>
          <h2 className="task-section-title">おすすめタスク</h2>
          <TaskGrid tasks={featuredTasks} busy={busy} name={name} mode={mode} featured onStartNew={onStartNew} />
        </>
      )}

      {otherTasks.length > 0 && (
        <>
          <h2 className="task-section-title">その他のタスク</h2>
          <TaskGrid tasks={otherTasks} busy={busy} name={name} mode={mode} onStartNew={onStartNew} />
        </>
      )}
    </div>
  );
}
