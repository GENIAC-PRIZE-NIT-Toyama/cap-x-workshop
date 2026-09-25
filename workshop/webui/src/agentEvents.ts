import type { AgentSSEEvent } from "./api";
import type { AgentLoopStatus, AgentTurnEvent } from "./notebooks";

export interface LiveTurn {
  turn: number;
  inputText: string;
  inputFrames: Record<string, string> | null;
  text: string;
  phase: "generating" | "executing";
}

// Everything AgentTrajectoryView renders for one Agent run.
export interface AgentRunView {
  turns: AgentTurnEvent[];
  live: LiveTurn | null;
  final: { status: AgentLoopStatus; detail: string | null } | null;
}

export const emptyRunView = (): AgentRunView => ({ turns: [], live: null, final: null });

// Pure reducer over the events of one run (same semantics as App.tsx's
// single-run handler); used for each task of a generalization test.
export function applyAgentEvent(v: AgentRunView, e: AgentSSEEvent): AgentRunView {
  switch (e.type) {
    case "turn_start":
      return {
        ...v,
        live: { turn: e.turn, inputText: e.input_text, inputFrames: e.input_frames, text: "", phase: "generating" },
      };
    case "llm_delta":
      return v.live && v.live.turn === e.turn ? { ...v, live: { ...v.live, text: v.live.text + e.text } } : v;
    case "exec_start":
      return v.live && v.live.turn === e.turn ? { ...v, live: { ...v.live, phase: "executing" } } : v;
    case "turn_done": {
      const live = v.live && v.live.turn === e.turn ? v.live : null;
      return {
        ...v,
        live: null,
        turns: [
          ...v.turns,
          {
            turn: e.turn,
            inputText: live?.inputText ?? "",
            inputFrames: live?.inputFrames ?? null,
            llmRaw: e.llm_raw,
            code: e.code,
            stdout: e.stdout,
            stderr: e.stderr,
            taskCompleted: e.task_completed,
            perceptionSteps: e.perception_steps,
          },
        ],
      };
    }
    case "loop_done": {
      // A turn still streaming when the loop ended (stop / LLM error) never
      // got a turn_done — keep what was generated so far.
      const partial = v.live && v.live.text ? v.live : null;
      return {
        turns: partial
          ? [
              ...v.turns,
              {
                turn: partial.turn,
                inputText: partial.inputText,
                inputFrames: partial.inputFrames,
                llmRaw: partial.text,
                code: null,
                stdout: "",
                stderr: "",
                taskCompleted: null,
                perceptionSteps: [],
              },
            ]
          : v.turns,
        live: null,
        final: { status: e.status, detail: e.detail },
      };
    }
  }
}
