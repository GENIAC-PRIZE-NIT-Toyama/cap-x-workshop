import type { CellResult, CreateSessionResponse, ResetResponse, TaskSummary } from "./types";

// All calls use relative paths on purpose: in dev, Vite proxies /api to the
// backend (vite.config.ts); in production the backend serves this app from
// the same origin. That single-origin design is also what makes the whole
// thing work unchanged behind a Cloudflare Tunnel — see
// WORKSHOP_WEBUI_SPEC.md section 2.

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as T;
}

export function listTasks(): Promise<{ tasks: TaskSummary[] }> {
  return request("/api/tasks");
}

export function createSession(taskId: string): Promise<CreateSessionResponse> {
  return request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ task_id: taskId }),
  });
}

export function runCell(sessionId: string, cellId: string, code: string): Promise<CellResult> {
  return request(`/api/sessions/${sessionId}/cells/run`, {
    method: "POST",
    body: JSON.stringify({ code, cell_id: cellId }),
  });
}

export function resetSession(sessionId: string): Promise<ResetResponse> {
  return request(`/api/sessions/${sessionId}/reset`, { method: "POST" });
}

export async function fetchReplayUrl(sessionId: string): Promise<string> {
  const res = await fetch(`/api/sessions/${sessionId}/replay`, { method: "POST" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function closeSession(sessionId: string): Promise<Response> {
  return fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
}

// window.location-based, not a hardcoded host: this is what lets the stream
// keep working unchanged behind the Cloudflare Tunnel (wss:// there, ws://
// in local dev) — see WORKSHOP_WEBUI_SPEC.md section 2.
export function streamUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/sessions/${sessionId}/stream`;
}
