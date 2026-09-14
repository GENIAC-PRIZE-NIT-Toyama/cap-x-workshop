// Client-side "notebooks": a name + task + the code of each cell, saved to
// localStorage so participants can pick up where they left off without the
// backend needing to know or store anything about it. Per-viewer only (see
// artifact/browser-storage conventions) — never shared between browsers or
// sessions, and can come back empty (private browsing, cleared site data).

export interface Notebook {
  id: string;
  name: string;
  taskId: string;
  cells: string[]; // code only — execution results aren't persisted
  updatedAt: string; // ISO timestamp
}

const STORAGE_KEY = "capx-workshop-notebooks";

function readAll(): Notebook[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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
