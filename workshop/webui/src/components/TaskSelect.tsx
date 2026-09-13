import { useEffect, useState } from "react";
import { listTasks } from "../api";
import type { TaskSummary } from "../types";

interface Props {
  onSelect: (taskId: string) => void;
  busy: boolean;
}

export default function TaskSelect({ onSelect, busy }: Props) {
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTasks()
      .then((res) => setTasks(res.tasks))
      .catch((err) => setError(String(err)));
  }, []);

  return (
    <div className="task-select">
      <h1>CaP-X Workshop</h1>
      <p className="subtitle">
        タスクを選んでセッションを開始してください。使用できるAPIはどのタスクでも共通です。
      </p>
      {error && <p className="error">タスク一覧の取得に失敗しました: {error}</p>}
      {!tasks && !error && <p>読み込み中...</p>}
      <div className="task-grid">
        {tasks?.map((task) => (
          <button
            key={task.task_id}
            className="task-card"
            disabled={busy}
            onClick={() => onSelect(task.task_id)}
          >
            <h2>{task.name}</h2>
            <p>{task.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
