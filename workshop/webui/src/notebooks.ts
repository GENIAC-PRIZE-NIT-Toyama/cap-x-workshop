// Client-side "notebooks": a name + task + the code of each cell, saved to
// localStorage so participants can pick up where they left off without the
// backend needing to know or store anything about it. Per-viewer only (see
// artifact/browser-storage conventions) — never shared between browsers or
// sessions, and can come back empty (private browsing, cleared site data).

// "manual" is the original hand-written Perception/Control Primitive
// notebook (unchanged). "prompt" is the LLM prompt-engineering notebook:
// one prompt + one generated code block per "experiment", with an optional
// chain of manual self-refine turns. A future "agent" mode can be added
// here without touching either of these.
export type NotebookMode = "manual" | "prompt";

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

export interface Notebook {
  id: string;
  name: string;
  taskId: string;
  mode: NotebookMode;
  cells: string[]; // code only — execution results aren't persisted. Used when mode === "manual"
  experiments?: PromptExperiment[]; // used when mode === "prompt"
  updatedAt: string; // ISO timestamp
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
