// Client-side "notebooks": a name + task + the code of each cell, saved to
// localStorage so participants can pick up where they left off without the
// backend needing to know or store anything about it. Per-viewer only (see
// artifact/browser-storage conventions) — never shared between browsers or
// sessions, and can come back empty (private browsing, cleared site data).

import type { PerceptionStep } from "./types";

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
export interface PromptVersion {
  id: string;
  name: string;
  systemPrompt: string;
  feedbackPrompt: string;
}

export interface AgentConfig {
  // Prompt versions the participant can switch between (top-left dropdown);
  // only the active one is sent when a run starts.
  promptVersions: PromptVersion[];
  activePromptId: string;
  visionEnabled: boolean;
  terminationMode: "simulation" | "agent";
  maxTurns: number;
  settings: GenerationSettings;
}

// One completed turn of an Agent Mode run — mirrors agent_loop.py's
// `turn_start`/`turn_done` event shapes combined into one record per turn.
// `inputFrames`/`perceptionSteps[].images` carry base64 images and are
// stripped before persisting (same "images are never persisted" policy as
// PromptTurn.lastRun above) — see App.tsx's saveNotebook effect, which
// builds the persisted copy; the in-memory copy used for live rendering
// keeps them.
export interface AgentTurnEvent {
  turn: number;
  inputText: string; // the rendered prompt actually sent to the LLM this turn
  inputFrames: Record<string, string> | null; // image(s) attached to that input, if vision was on
  llmRaw: string;
  code: string | null; // null: the model emitted no code block (nothing was executed)
  stdout: string;
  stderr: string;
  taskCompleted: boolean | null;
  perceptionSteps: PerceptionStep[];
}

// Mirrors agent_loop.py's `LoopStatus`.
export type AgentLoopStatus = "task_completed" | "agent_finished" | "max_turns" | "stopped" | "error";

// What a run was started with — kept next to its result so Export can
// describe the run even if the participant edits the prompts afterwards.
export interface AgentRunInfo {
  startedAt: string; // ISO timestamp
  promptName: string;
  systemPrompt: string;
  feedbackPrompt: string;
  visionEnabled: boolean;
  terminationMode: AgentConfig["terminationMode"];
  maxTurns: number;
  temperature: number;
}

export interface AgentRunResult {
  status: AgentLoopStatus;
  detail: string | null;
  turns: AgentTurnEvent[];
  runInfo?: AgentRunInfo;
}

export interface Notebook {
  id: string;
  name: string;
  taskId: string;
  suiteId?: string; // Agent mode: the suite the notebook was started from
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

# Python コードブロック
- 行動が必要な場合は、実行するPythonコードを**必ずコードブロック(\`\`\`python\`\`\`)**として出力してください。
- 識別子(\`\`\`python\`\`\`)がない場合は、実行可能なコードブロックとして認識されません。
- コードブロックは複数記述しても構いませんが、実際に実行されるのは最後のPythonコードブロック1つだけです。そのため、その時点で実行すべき行動は最後のコードブロックに含めてください。
- コードブロック内にコメントを書く場合は、必ず日本語で記述してください。
- タスクを完了した場合はPythonコードブロックを出力せず、タスクが完了したと判断した理由だけを簡潔に答えてください。`;

const DEFAULT_AGENT_FEEDBACK_PROMPT = `直前に実行したコードの結果です。

stdout:
{{ stdout }}

stderr:
{{ stderr }}

(ターン {{ turn }} / {{ max_turns }})

タスクが完了しているか、Perception APIなどを使って自分で確認してください。完了していればコードを書かずにその旨を答え、まだなら続きのコードを書いてください。`;

let promptVersionCounter = 0;
export function newPromptVersion(name: string, base?: Pick<PromptVersion, "systemPrompt" | "feedbackPrompt">): PromptVersion {
  promptVersionCounter += 1;
  return {
    id: `pv-${Date.now().toString(36)}-${promptVersionCounter}`,
    name,
    systemPrompt: base?.systemPrompt ?? DEFAULT_AGENT_SYSTEM_PROMPT,
    feedbackPrompt: base?.feedbackPrompt ?? DEFAULT_AGENT_FEEDBACK_PROMPT,
  };
}

export function defaultAgentConfig(): AgentConfig {
  const v1 = newPromptVersion("v1");
  return {
    promptVersions: [v1],
    activePromptId: v1.id,
    visionEnabled: true,
    terminationMode: "agent",
    maxTurns: 15,
    settings: { temperature: 0.7 },
  };
}

export function activePrompt(config: AgentConfig): PromptVersion {
  return config.promptVersions.find((v) => v.id === config.activePromptId) ?? config.promptVersions[0];
}

// Notebooks saved before prompt versioning carry systemPrompt/feedbackPrompt
// directly on the config — fold them into a single "v1" version.
export function normalizeAgentConfig(raw: unknown): AgentConfig {
  const base = defaultAgentConfig();
  if (!raw || typeof raw !== "object") return base;
  const c = raw as Partial<AgentConfig> & { systemPrompt?: string; feedbackPrompt?: string };
  let versions = Array.isArray(c.promptVersions) ? c.promptVersions.filter((v) => v && v.id) : [];
  if (versions.length === 0) {
    versions = [
      {
        ...base.promptVersions[0],
        systemPrompt: c.systemPrompt ?? base.promptVersions[0].systemPrompt,
        feedbackPrompt: c.feedbackPrompt ?? base.promptVersions[0].feedbackPrompt,
      },
    ];
  }
  return {
    promptVersions: versions,
    activePromptId: versions.some((v) => v.id === c.activePromptId) ? (c.activePromptId as string) : versions[0].id,
    visionEnabled: c.visionEnabled ?? base.visionEnabled,
    terminationMode: c.terminationMode ?? base.terminationMode,
    maxTurns: c.maxTurns ?? base.maxTurns,
    settings: { ...base.settings, ...(c.settings ?? {}) },
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
