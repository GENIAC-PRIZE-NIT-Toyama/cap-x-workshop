import type { CellResult, CreateSessionResponse, PerceptionStep, ResetResponse, TaskSummary } from "./types";
import { activePrompt, type AgentConfig, type AgentLoopStatus, type GenerationSettings } from "./notebooks";

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

export function extractCode(text: string): string {
  const closedPython = text.match(/```python\s*\n([\s\S]*?)```/i);
  if (closedPython) return closedPython[1].trim();
  const closedAny = text.match(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/);
  if (closedAny) return closedAny[1].trim();

  const unclosedPython = text.match(/```python\s*\n([\s\S]*)$/i);
  if (unclosedPython) {
    let code = unclosedPython[1];
    code = code.replace(/```.*$/, "");
    return code.trim();
  }

  const unclosedAny = text.match(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*)$/);
  if (unclosedAny) {
    let code = unclosedAny[1];
    code = code.replace(/```.*$/, "");
    return code.trim();
  }

  return text.trim();
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
  signal?: AbortSignal,
): Promise<{ fullText: string; code: string }> {
  const res = await fetch(`/api/sessions/${sessionId}/experiments/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, settings }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let result: { fullText: string; code: string } | null = null;

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        break;
      }
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
          fullText += event.text;
          onDelta(event.text);
        } else if (event.type === "error") {
          throw new Error(event.text ?? "LLM generation failed");
        } else if (event.type === "done") {
          result = { fullText: event.full_text ?? fullText, code: event.code ?? extractCode(fullText) };
        }
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      return { fullText, code: extractCode(fullText) };
    }
    throw err;
  }

  if (signal?.aborted) {
    return { fullText, code: extractCode(fullText) };
  }

  if (!result) {
    if (fullText) {
      return { fullText, code: extractCode(fullText) };
    }
    throw new Error("Stream ended without a completion event");
  }
  return result;
}

// window.location-based, not a hardcoded host: this is what lets the stream
// keep working unchanged behind the Cloudflare Tunnel (wss:// there, ws://
// in local dev) — see WORKSHOP_WEBUI_SPEC.md section 2.
export function streamUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/sessions/${sessionId}/stream`;
}

// ---------------------------------------------------------------------
// Agent Mode (WORKSHOP_AGENT_PLAN.md) — mirrors agent_loop.py's event
// shapes exactly (backend/agent_loop.py's `run_agent_loop()` docstring).
// Unlike "prompt" mode's streamGenerate() above, the backend drives the
// whole multi-turn loop itself; this is just the SSE consumer for it.
// ---------------------------------------------------------------------

export type AgentSSEEvent =
  | { type: "turn_start"; turn: number; input_text: string; input_frames: Record<string, string> | null }
  | { type: "llm_delta"; turn: number; text: string }
  | {
      type: "turn_done";
      turn: number;
      llm_raw: string;
      code: string | null;
      stdout: string;
      stderr: string;
      frames: Record<string, string> | null;
      task_completed: boolean | null;
      perception_steps: PerceptionStep[];
    }
  | { type: "exec_start"; turn: number }
  | { type: "loop_done"; status: AgentLoopStatus; turn: number; detail: string | null };

// Streams one full Agent Loop run. Resolves once the backend's `loop_done`
// event has been delivered to `onEvent` and the SSE response closes (the
// backend always emits exactly one `loop_done` then ends the stream — see
// agent_loop.py) — there is no separate "final result" return value the
// way streamGenerate() has one; every event, including the terminal one,
// goes through `onEvent`. `signal` is for the caller's own cleanup (e.g.
// unmount); actually *stopping* the loop is `stopAgentLoop()` below, which
// asks the backend to end the loop on its own terms (finishing the current
// turn's feedback) rather than just severing this fetch.
export async function runAgentLoop(
  sessionId: string,
  config: AgentConfig,
  onEvent: (event: AgentSSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const prompt = activePrompt(config);
  const res = await fetch(`/api/sessions/${sessionId}/agent/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_prompt: prompt.systemPrompt,
      feedback_prompt: prompt.feedbackPrompt,
      vision_enabled: config.visionEnabled,
      termination_mode: config.terminationMode,
      max_turns: config.maxTurns,
      settings: config.settings,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        return;
      }
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const payload = frame.startsWith("data: ") ? frame.slice(6) : frame;
        if (!payload) continue;
        onEvent(JSON.parse(payload) as AgentSSEEvent);
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) return;
    throw err;
  }
}

// Asks the backend to end the in-flight Agent Loop for this session at its
// next check (see app.py's /agent/stop and agent_loop.py's
// AgentLoopRegistry) — best-effort, not instant: a cell already executing
// runs to completion first.
export function stopAgentLoop(sessionId: string): Promise<Response> {
  return fetch(`/api/sessions/${sessionId}/agent/stop`, { method: "POST" });
}

// Renders a System/Feedback Prompt template against arbitrary variables
// without starting or touching any session — pure Jinja2 rendering (see
// app.py's /api/agent/preview + prompt_render.py). Returns `{ rendered }`
// on success or `{ error }` on a template error (undefined variable, bad
// syntax); never rejects for a template-side problem, only for a network
// failure.
export function previewAgentPrompt(
  template: string,
  variables: Record<string, unknown>,
): Promise<{ rendered?: string; error?: string }> {
  return request("/api/agent/preview", {
    method: "POST",
    body: JSON.stringify({ template, variables }),
  });
}

// ---------------------------------------------------------------------
// Generalization test (backend/eval_runner.py): one Agent config run against
// several tasks of a suite, one after another; each task's run is streamed
// as the same events a single Agent run emits, wrapped in `job_event`.
// ---------------------------------------------------------------------

export interface EvalSuite {
  suite_id: string;
  name: string;
  description: string;
  default_task_ids: string[];
  tasks: { task_id: string; name: string }[];
}

export type EvalStatus = AgentLoopStatus | "skipped";

export type EvalSSEEvent =
  | { type: "eval_start"; eval_id: string; jobs: { job_id: string; task_id: string; name: string }[] }
  | { type: "job_boot"; job_id: string }
  | { type: "job_start"; job_id: string; session_id: string }
  | { type: "job_event"; job_id: string; event: AgentSSEEvent }
  | { type: "job_done"; job_id: string; success: boolean; status: EvalStatus; detail: string | null }
  | { type: "eval_done"; stopped: boolean };

export function listEvalSuites(): Promise<{ suites: EvalSuite[] }> {
  return request("/api/eval/suites");
}

export async function runEval(
  body: {
    suite_id: string;
    task_ids: string[];
    reuse: { task_id: string; session_id: string } | null;
    config: AgentConfig;
  },
  onEvent: (event: EvalSSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const prompt = activePrompt(body.config);
  const res = await fetch("/api/eval/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      suite_id: body.suite_id,
      task_ids: body.task_ids,
      reuse: body.reuse,
      agent: {
        system_prompt: prompt.systemPrompt,
        feedback_prompt: prompt.feedbackPrompt,
        vision_enabled: body.config.visionEnabled,
        termination_mode: body.config.terminationMode,
        max_turns: body.config.maxTurns,
        settings: body.config.settings,
      },
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const payload = frame.startsWith("data: ") ? frame.slice(6) : frame;
        if (payload) onEvent(JSON.parse(payload) as EvalSSEEvent);
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) return;
    throw err;
  }
}

export function stopEval(evalId: string): Promise<Response> {
  return fetch(`/api/eval/${evalId}/stop`, { method: "POST" });
}
