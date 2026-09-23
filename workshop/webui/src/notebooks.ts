// Client-side "notebooks": a name + task + the code of each cell, saved to
// localStorage so participants can pick up where they left off without the
// backend needing to know or store anything about it. Per-viewer only (see
// artifact/browser-storage conventions) — never shared between browsers or
// sessions, and can come back empty (private browsing, cleared site data).

// "manual" is the original hand-written Perception/Control Primitive
// notebook (unchanged). "prompt" is the LLM prompt-engineering notebook:
// one prompt + one generated code block per "experiment", with an optional
// chain of manual self-refine turns. "agent" (WORKSHOP_AGENT_PLAN.md) is a
// server-orchestrated LLM<->code-execution loop: the participant edits a
// System Prompt / Feedback Prompt template pair (Jinja2) instead of driving
// turns by hand.
export type NotebookMode = "manual" | "prompt" | "agent";

export interface GenerationSettings {
  temperature: number; // kept in an object (not a bare field) so future
  // params (top_p, max_tokens, ...) slot in without a schema migration
}

export interface PromptTurn {
  userText: string; // the prompt the participant actually sent (freely edited)
  settings: GenerationSettings;
  llmRawResponse: string; // full LLM output for this turn
  extractedCode: string; // extracted (and possibly hand-edited) code block
  lastRun?: { stdout: string; stderr: string }; // most recent Reset&Run result for this turn — images/video are never persisted
}

export interface PromptExperiment {
  id: string;
  turns: PromptTurn[]; // turns[0] = initial prompt; turns[1..] = self-refine turns
}

// Agent Mode config — the two Jinja2 templates plus the run-level toggles
// from WORKSHOP_AGENT_PLAN.md §1.3's `AgentRunRequest` (backend/agent_loop.py).
// Not tied to a particular taskId: the whole point of Agent Mode is writing
// a prompt that generalizes across tasks, so this shape is reused as-is if
// Phase 3 later runs the same config against several tasks at once.
export interface AgentConfig {
  systemPrompt: string;
  feedbackPrompt: string;
  visionEnabled: boolean;
  terminationMode: "simulation" | "agent";
  maxTurns: number;
  settings: GenerationSettings;
}

// One completed turn of an Agent Mode run — mirrors agent_loop.py's
// `turn_done` event shape (backend/agent_loop.py), minus `frames` (images
// are never persisted, same policy as PromptTurn.lastRun above).
export interface AgentTurnEvent {
  turn: number;
  llmRaw: string;
  code: string;
  stdout: string;
  stderr: string;
  taskCompleted: boolean | null;
}

// Mirrors agent_loop.py's `LoopStatus`.
export type AgentLoopStatus = "task_completed" | "agent_finished" | "max_turns" | "stopped" | "error";

export interface AgentRunResult {
  status: AgentLoopStatus;
  detail: string | null;
  turns: AgentTurnEvent[];
}

export interface Notebook {
  id: string;
  name: string;
  taskId: string;
  mode: NotebookMode;
  cells: string[]; // code only — execution results aren't persisted. Used when mode === "manual"
  experiments?: PromptExperiment[]; // used when mode === "prompt"
  agentConfig?: AgentConfig; // used when mode === "agent"
  agentResult?: AgentRunResult; // most recent completed/stopped run, if any — used when mode === "agent"
  updatedAt: string; // ISO timestamp
}

// Baseline templates a new Agent Mode notebook starts from (never blank —
// see WORKSHOP_AGENT_PLAN.md's "動くベースラインを配る" note): they already
// demonstrate the mechanic termination_mode="agent" depends on (stop
// writing code once the task looks done) and deliberately do *not*
// reference `{{ is_task_completed }}`, so participants have to reach for
// Perception calls themselves to judge completion — see agent_loop.py's
// `feedback_vars` for the full variable set this can reference.
const DEFAULT_AGENT_SYSTEM_PROMPT = `あなたはロボットを制御するエージェントです。

タスク: {{ task_instruction }}

以下のAPIが利用できます:
{{ api_document }}

思考のためにコメントを書いても構いませんが、実行するコードは最後のコードブロック(\`\`\`python ... \`\`\`)に1つだけ書いてください。
タスクが完了したと判断したら、コードブロックを書かずにその理由だけ答えてください。`;

const DEFAULT_AGENT_FEEDBACK_PROMPT = `直前に実行したコードの結果です。

stdout:
{{ stdout }}

stderr:
{{ stderr }}

(ターン {{ turn }} / {{ max_turns }})

タスクが完了しているか、Perception APIなどを使って自分で確認してください。完了していればコードを書かずにその旨を答え、まだなら続きのコードを書いてください。`;

export function defaultAgentConfig(): AgentConfig {
  return {
    systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
    feedbackPrompt: DEFAULT_AGENT_FEEDBACK_PROMPT,
    visionEnabled: false,
    terminationMode: "agent",
    maxTurns: 10,
    settings: { temperature: 0.7 },
  };
}

const STORAGE_KEY = "capx-workshop-notebooks";

function readAll(): Notebook[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Older saved notebooks predate `mode` — treat them as "manual" so they
    // keep opening in the original UI unchanged.
    return parsed.map((nb) => ({ mode: "manual" as const, ...nb }));
  } catch {
    return [];
  }
}

function writeAll(notebooks: Notebook[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notebooks));
  } catch {
    // localStorage unavailable (private browsing, quota, disabled) — this is
    // a convenience feature, not something the rest of the app depends on.
  }
}

export function listNotebooks(): Notebook[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveNotebook(notebook: Notebook): void {
  const all = readAll();
  const idx = all.findIndex((n) => n.id === notebook.id);
  if (idx >= 0) {
    all[idx] = notebook;
  } else {
    all.push(notebook);
  }
  writeAll(all);
}

export function deleteNotebook(id: string): void {
  writeAll(readAll().filter((n) => n.id !== id));
}

export function newNotebookId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `nb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
