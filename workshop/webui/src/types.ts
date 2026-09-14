export interface TaskSummary {
  task_id: string;
  name: string;
  description: string;
  featured: boolean;
}

export interface PerceptionStep {
  tool_name: string;
  text: string;
  images: string[]; // base64-encoded, no data: prefix
  step_index: number;
  timestamp: string;
  highlight: boolean;
}

export interface CellResult {
  cell_id: string;
  frames: Record<string, string>;
  stdout: string;
  stderr: string;
  ok: boolean;
  reward: number;
  terminated: boolean;
  truncated: boolean;
  task_completed: boolean | null;
  perception_steps: PerceptionStep[];
}

export interface CreateSessionResponse {
  session_id: string;
  task_id: string;
  frames: Record<string, string>;
  task_prompt: string | null;
  api_docs: string;
}

export interface ResetResponse {
  frames: Record<string, string>;
  task_prompt: string | null;
  api_docs: string;
}
