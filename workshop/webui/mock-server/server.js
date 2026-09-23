// Mock of workshop/backend for local frontend development only. It answers
// the same /api routes on the same port (8200) so vite.config.ts's proxy
// needs no change, but nothing here runs a robot, Docker, or an LLM.
// See WORKSHOP_WEBUI_LOCAL_DEV.md for what is and isn't mimicked.

import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { renderFrame } from "./png.js";
import {
  AGENT_TURN_RESPONSES,
  API_DOCS,
  GENERATE_RESPONSE,
  GENERATE_RESPONSE_LONG,
  PRIMARY_CAMERA,
  TASKS,
  TASK_PROMPTS,
  TASK_PROMPTS_JA,
} from "./fixtures.js";

const HOST = "127.0.0.1";
const PORT = 8200;
const CELL_RUN_MS = 1500;
const STREAM_INTERVAL_MS = 150;
const SSE_CHUNK_CHARS = 24;
const SSE_CHUNK_INTERVAL_MS = 40;

const sessions = new Map();
let sessionCounter = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ValidationError extends Error {
  constructor(detail) {
    super("validation error");
    this.detail = detail;
  }
}

function newSession(taskId) {
  sessionCounter += 1;
  return {
    id: `mock-${sessionCounter}`,
    taskId,
    step: 0,
    // The real worker streams one camera (env_runtime.py's save_camera_name)
    // and keys `frames` by it plus "wrist"; sending both cameras on /stream
    // would interleave them in the client-side replay.
    primaryCamera: PRIMARY_CAMERA[taskId],
    sockets: new Set(),
    queue: Promise.resolve(),
  };
}

// The real SessionManager holds a per-session asyncio.Lock around every
// worker call, so a reset can't interleave with a running cell.
function withSessionLock(session, fn) {
  const run = session.queue.then(fn);
  session.queue = run.catch(() => {});
  return run;
}

function framesFor(session) {
  return Object.fromEntries(
    [session.primaryCamera, "wrist"].map((camera) => [camera, renderFrame({ camera, step: session.step })]),
  );
}

function resetPayload(session) {
  return {
    frames: framesFor(session),
    task_prompt: TASK_PROMPTS[session.taskId],
    task_prompt_ja: TASK_PROMPTS_JA[session.taskId] ?? null,
    api_docs: API_DOCS,
  };
}

function send(req, res, status, body, contentType = "application/json") {
  res.writeHead(status, { "Content-Type": contentType, "X-Mock-Backend": "1" });
  res.end(contentType === "application/json" ? JSON.stringify(body) : body);
  console.log(`${req.method} ${req.url} -> ${status}`);
}

// Mirrors FastAPI/Pydantic's 422 for a malformed body or a missing/mistyped
// required field, so a frontend request-shape regression fails here too.
function readJson(req, required = {}) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("error", reject);
    req.on("end", () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return reject(new ValidationError([{ type: "json_invalid", loc: ["body"], msg: "JSON decode error" }]));
      }
      const detail = [];
      for (const [field, type] of Object.entries(required)) {
        if (body[field] === undefined) {
          detail.push({ type: "missing", loc: ["body", field], msg: "Field required" });
        } else if (type === "array" ? !Array.isArray(body[field]) : typeof body[field] !== type) {
          detail.push({ type: `${type}_type`, loc: ["body", field], msg: `Input should be a valid ${type}` });
        }
      }
      if (detail.length > 0) return reject(new ValidationError(detail));
      resolve(body);
    });
  });
}

function extractCode(text) {
  const match = /```(?:python)?\n([\s\S]*?)```/.exec(text);
  return match ? match[1].trim() : text.trim();
}

// Mirrors code_extract.py's extract_last_code_block(): the *last* fenced
// block, or null if there isn't one at all — unlike extractCode() above
// (used by prompt mode), this deliberately does NOT fall back to treating
// the whole response as code. Agent Mode's mock loop (agentRun()) uses this
// null case as its "the agent chose to stop" signal, same as the real
// backend's agent_loop.py.
function extractLastCodeBlock(text) {
  const matches = [...text.matchAll(/```(?:python)?\n([\s\S]*?)```/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

// Not a real Jinja2 renderer — just enough `{{ name }}` substitution to
// exercise the frontend's preview button (AgentConfigPanel.tsx) against
// something. No {% for %}/{% if %} support; the real backend's
// prompt_render.py handles those against an actual SandboxedEnvironment.
function mockRenderTemplate(template, variables) {
  const missing = new Set();
  const rendered = template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name) => {
    if (!(name in variables) || variables[name] === undefined) {
      missing.add(name);
      return `{{ ${name} }}`;
    }
    return String(variables[name] ?? "");
  });
  if (missing.size > 0) {
    const names = Object.keys(variables).sort().join(", ");
    return { error: `[MOCK] '${[...missing][0]}' is undefined. 使える変数: ${names}` };
  }
  return { rendered };
}

function broadcastFrame(session) {
  const camera = session.primaryCamera;
  const message = JSON.stringify({ camera, image: renderFrame({ camera, step: session.step }) });
  for (const socket of session.sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

// Advances the "robot" a few frames while the cell is "running", pushing
// each one to /stream subscribers — that's what drives the live camera view
// and the client-side replay.
async function simulateRun(session) {
  const ticks = Math.floor(CELL_RUN_MS / STREAM_INTERVAL_MS);
  for (let i = 0; i < ticks; i++) {
    await sleep(STREAM_INTERVAL_MS);
    session.step += 1;
    broadcastFrame(session);
  }
}

function runCellResult(session, cellId, code) {
  const lines = code.split("\n").filter((line) => line.trim() !== "").length;
  const failed = /\braise\b|error/i.test(code);
  const usesPerception = /get_object_pose|sample_grasp_pose/.test(code);

  const perceptionSteps = usesPerception
    ? [
        {
          tool_name: "[MOCK] SAM3 Text Segmentation",
          text: "[MOCK] Running SAM3 text-prompt: 'red cube' … Returned 1 mask(s), best score: 0.987",
          images: [renderFrame({ camera: session.primaryCamera, step: session.step })],
          step_index: session.step,
          timestamp: new Date().toISOString(),
          highlight: true,
        },
      ]
    : [];

  return {
    cell_id: cellId,
    frames: framesFor(session),
    stdout: failed ? "" : `[MOCK] executed ${lines} line(s); no robot was moved.\n`,
    stderr: failed
      ? [
          "Traceback (most recent call last):",
          '  File "<cell>", line 1, in <module>',
          "RuntimeError: [MOCK] this cell contains 'raise' or 'error', so the mock reports a failure",
          "",
        ].join("\n")
      : "",
    ok: !failed,
    reward: 0.0,
    terminated: false,
    truncated: false,
    task_completed: null,
    perception_steps: perceptionSteps,
  };
}

async function streamGenerate(req, res, messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const response = lastUser.includes("[long]") ? GENERATE_RESPONSE_LONG : GENERATE_RESPONSE;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Mock-Backend": "1",
  });
  for (let i = 0; i < response.length; i += SSE_CHUNK_CHARS) {
    res.write(`data: ${JSON.stringify({ type: "delta", text: response.slice(i, i + SSE_CHUNK_CHARS) })}\n\n`);
    await sleep(SSE_CHUNK_INTERVAL_MS);
  }
  res.write(`data: ${JSON.stringify({ type: "done", full_text: response, code: extractCode(response) })}\n\n`);
  res.end();
  console.log(`${req.method} ${req.url} -> 200 (sse)`);
}

// Mock of agent_loop.py's run_agent_loop() — streams the canned
// AGENT_TURN_RESPONSES as turn_start/llm_delta/turn_done events, honoring
// termination_mode/max_turns/vision_enabled/stop the same way the real
// backend's event shapes do, so the frontend's SSE consumer (api.ts's
// runAgentLoop()) exercises the exact same code path against either
// backend.
async function agentRun(req, res, session, body) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Mock-Backend": "1",
  });
  const write = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  session.agentStopRequested = false;
  const maxTurns = body.max_turns ?? 10;
  const turnCount = Math.min(AGENT_TURN_RESPONSES.length, maxTurns);

  for (let i = 0; i < turnCount; i++) {
    const turn = i + 1;
    if (session.agentStopRequested) {
      write({ type: "loop_done", status: "stopped", turn: turn - 1, detail: null });
      return res.end();
    }

    write({ type: "turn_start", turn });
    const text = AGENT_TURN_RESPONSES[i];
    for (let c = 0; c < text.length; c += SSE_CHUNK_CHARS) {
      write({ type: "llm_delta", turn, text: text.slice(c, c + SSE_CHUNK_CHARS) });
      await sleep(SSE_CHUNK_INTERVAL_MS);
    }

    const code = extractLastCodeBlock(text);
    if (code === null) {
      write({ type: "loop_done", status: "agent_finished", turn, detail: null });
      return res.end();
    }

    await withSessionLock(session, () => simulateRun(session));
    const result = runCellResult(session, `agent-turn-${turn}`, code);
    // Canned "success" after turn 2, purely so termination_mode="simulation"
    // has something to trigger on in the mock.
    const taskCompleted = turn >= 2 ? true : null;
    write({
      type: "turn_done",
      turn,
      llm_raw: text,
      code,
      stdout: result.stdout,
      stderr: result.stderr,
      frames: body.vision_enabled ? result.frames : null,
      task_completed: taskCompleted,
    });

    if (body.termination_mode === "simulation" && taskCompleted) {
      write({ type: "loop_done", status: "task_completed", turn, detail: null });
      return res.end();
    }
    if (session.agentStopRequested) {
      write({ type: "loop_done", status: "stopped", turn, detail: null });
      return res.end();
    }
  }

  write({ type: "loop_done", status: "max_turns", turn: turnCount, detail: null });
  res.end();
  console.log(`${req.method} ${req.url} -> 200 (sse, agent)`);
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, `http://${HOST}`);

  if (req.method === "GET" && pathname === "/api/tasks") {
    return send(req, res, 200, { tasks: TASKS });
  }

  if (req.method === "POST" && pathname === "/api/sessions") {
    const body = await readJson(req, { task_id: "string" });
    if (!TASKS.some((task) => task.task_id === body.task_id)) {
      return send(req, res, 404, { detail: `Unknown task_id: ${body.task_id}` });
    }
    const session = newSession(body.task_id);
    sessions.set(session.id, session);
    return send(req, res, 200, { session_id: session.id, task_id: session.taskId, ...resetPayload(session) });
  }

  if (req.method === "POST" && pathname === "/api/agent/preview") {
    const body = await readJson(req, { template: "string" });
    return send(req, res, 200, mockRenderTemplate(body.template, body.variables ?? {}));
  }

  const match =
    /^\/api\/sessions\/([^/]+)(?:\/(observation|cells\/run|reset|experiments\/generate|replay|agent\/run|agent\/stop))?$/.exec(
      pathname,
    );
  if (!match) return send(req, res, 404, { detail: "Not Found" });
  const session = sessions.get(match[1]);
  const action = match[2];

  // Like the real backend, closing is idempotent: 200 whether or not the
  // session exists (app.py's delete_session never 404s).
  if (req.method === "DELETE" && !action) {
    if (session) {
      await withSessionLock(session, () => {
        for (const socket of session.sockets) socket.close();
        sessions.delete(session.id);
      });
    }
    return send(req, res, 200, { status: "closed" });
  }

  if (!session) return send(req, res, 404, { detail: "Session not found" });

  if (req.method === "GET" && action === "observation") {
    const frames = await withSessionLock(session, () => framesFor(session));
    return send(req, res, 200, { frames });
  }
  if (req.method === "POST" && action === "cells/run") {
    const body = await readJson(req, { cell_id: "string", code: "string" });
    const result = await withSessionLock(session, async () => {
      await simulateRun(session);
      return runCellResult(session, body.cell_id, body.code);
    });
    return send(req, res, 200, result);
  }
  if (req.method === "POST" && action === "reset") {
    const payload = await withSessionLock(session, () => {
      session.step = 0;
      return resetPayload(session);
    });
    return send(req, res, 200, payload);
  }
  if (req.method === "POST" && action === "experiments/generate") {
    const body = await readJson(req, { messages: "array" });
    return streamGenerate(req, res, body.messages);
  }
  if (req.method === "POST" && action === "replay") {
    return send(req, res, 501, "[MOCK] replay is not supported by the mock backend", "text/plain");
  }
  if (req.method === "POST" && action === "agent/run") {
    const body = await readJson(req, { system_prompt: "string", feedback_prompt: "string" });
    return agentRun(req, res, session, body);
  }
  if (req.method === "POST" && action === "agent/stop") {
    session.agentStopRequested = true;
    return send(req, res, 200, { ok: true });
  }
  return send(req, res, 405, { detail: "Method Not Allowed" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (res.headersSent) return;
    if (err instanceof ValidationError) return send(req, res, 422, { detail: err.detail });
    console.error(err);
    send(req, res, 500, { detail: String(err) });
  });
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const match = /^\/api\/sessions\/([^/]+)\/stream$/.exec(req.url);
  if (!match) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const session = sessions.get(match[1]);
    if (!session) {
      ws.close(4004, "Session not found");
      console.log(`WS ${req.url} -> 4004`);
      return;
    }
    session.sockets.add(ws);
    ws.on("close", () => session.sockets.delete(ws));
    ws.on("error", (err) => {
      console.error(`WS ${req.url} error:`, err.message);
      session.sockets.delete(ws);
    });
    console.log(`WS ${req.url} -> open`);
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[MOCK] port ${PORT} is already in use — is the real backend (or another mock) running?`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`
==================================================================
  [MOCK] CaP-X Workshop mock backend — NOT the real backend.
  No robot, no Docker, no LLM. Task names carry a "[MOCK]" prefix
  and camera frames have a magenta band on top.
  Listening on http://${HOST}:${PORT}  (run "npm run dev" alongside)
==================================================================
`);
});
