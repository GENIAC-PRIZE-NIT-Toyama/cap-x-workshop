import type { CellResult, CreateSessionResponse, ResetResponse, TaskSummary } from "./types";
import type { GenerationSettings } from "./notebooks";

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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Consumes the backend's SSE stream by hand (fetch + ReadableStream) rather
// than EventSource, since EventSource can't send a POST body — the message
// history has to go up with the request, not as a query string. Each SSE
// frame is "data: <json>\n\n"; onDelta fires per content chunk as it
// streams in, and the resolved value carries the final full text plus the
// backend's already-extracted code block (see code_extract.py).
export async function streamGenerate(
  sessionId: string,
  messages: ChatMessage[],
  settings: GenerationSettings,
  onDelta: (text: string) => void,
): Promise<{ fullText: string; code: string }> {
  const res = await fetch(`/api/sessions/${sessionId}/experiments/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, settings }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { fullText: string; code: string } | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx: number;
    while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const payload = frame.startsWith("data: ") ? frame.slice(6) : frame;
      if (!payload) continue;

      const event = JSON.parse(payload) as {
        type: "delta" | "done" | "error";
        text?: string;
        full_text?: string;
        code?: string;
      };
      if (event.type === "delta" && event.text) {
        onDelta(event.text);
      } else if (event.type === "error") {
        throw new Error(event.text ?? "LLM generation failed");
      } else if (event.type === "done") {
        result = { fullText: event.full_text ?? "", code: event.code ?? "" };
      }
    }
  }

  if (!result) throw new Error("Stream ended without a completion event");
  return result;
}

// window.location-based, not a hardcoded host: this is what lets the stream
// keep working unchanged behind the Cloudflare Tunnel (wss:// there, ws://
// in local dev) — see WORKSHOP_WEBUI_SPEC.md section 2.
export function streamUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/sessions/${sessionId}/stream`;
}
