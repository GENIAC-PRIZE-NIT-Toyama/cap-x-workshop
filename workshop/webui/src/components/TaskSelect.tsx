import { useEffect, useState } from "react";
import { listTasks } from "../api";
import { listNotebooks, deleteNotebook, type Notebook } from "../notebooks";
import type { TaskSummary } from "../types";

interface Props {
  onStartNew: (taskId: string, name: string) => void;
  onOpenNotebook: (notebook: Notebook) => void;
  busy: boolean;
}

function TaskGrid({
  tasks,
  busy,
  name,
  featured,
  onStartNew,
}: {
  tasks: TaskSummary[];
  busy: boolean;
  name: string;
  featured?: boolean;
  onStartNew: (taskId: string, name: string) => void;
}) {
  return (
    <div className="task-grid">
      {tasks.map((task) => (
        <button
          key={task.task_id}
          className={featured ? "task-card featured" : "task-card"}
          disabled={busy}
          onClick={() => onStartNew(task.task_id, name.trim() || task.name)}
        >
          <h2>{task.name}</h2>
          <p>{task.description}</p>
        </button>
      ))}
    </div>
  );
}

export default function TaskSelect({ onStartNew, onOpenNotebook, busy }: Props) {
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notebooks, setNotebooks] = useState<Notebook[]>(() => listNotebooks());

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
                <span className="notebook-row-meta">
                  {taskName(nb.taskId)} ・ {new Date(nb.updatedAt).toLocaleString()} ・{" "}
                  {nb.cells.length}セル
                </span>
              </div>
              <div className="notebook-row-actions">
                <button disabled={busy} onClick={() => onOpenNotebook(nb)}>
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

      {error && <p className="error">タスク一覧の取得に失敗しました: {error}</p>}
      {!tasks && !error && <p>読み込み中...</p>}

      {featuredTasks.length > 0 && (
        <>
          <h2 className="task-section-title">おすすめタスク</h2>
          <TaskGrid tasks={featuredTasks} busy={busy} name={name} featured onStartNew={onStartNew} />
        </>
      )}

      {otherTasks.length > 0 && (
        <>
          <h2 className="task-section-title">その他のタスク</h2>
          <TaskGrid tasks={otherTasks} busy={busy} name={name} onStartNew={onStartNew} />
        </>
      )}
    </div>
  );
}
