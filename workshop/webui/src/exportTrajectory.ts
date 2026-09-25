import type { AgentLoopStatus, AgentRunInfo, AgentTurnEvent } from "./notebooks";

const STATUS_TEXT: Record<AgentLoopStatus, string> = {
  task_completed: "タスク完了(シミュレーション判定)",
  agent_finished: "Agentが終了を判断",
  max_turns: "最大ターン数に到達",
  stopped: "停止",
  error: "エラーで終了",
};

const pad = (n: number) => String(n).padStart(2, "0");

// MMDDHHMMSS (local time) — used as the file name of both exported files.
export function exportTimestamp(d = new Date()): string {
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function section(title: string, body: string): string {
  return `[${title}]\n${body.trim() ? body.replace(/\s+$/, "") : "(なし)"}\n`;
}

// Plain-text, human-readable record of one run. Images are left out.
export function buildTrajectoryText(args: {
  taskId: string;
  notebookName: string;
  runInfo: AgentRunInfo | null;
  turns: AgentTurnEvent[];
  status: { status: AgentLoopStatus; detail: string | null } | null;
}): string {
  const { taskId, notebookName, runInfo, turns, status } = args;
  const lines: string[] = [];
  lines.push("CaP-X Agent Trajectory");
  lines.push(`Notebook : ${notebookName || "Untitled"}`);
  lines.push(`Task     : ${taskId}`);
  lines.push(`Exported : ${new Date().toLocaleString("ja-JP")}`);
  if (runInfo) {
    lines.push(`Prompt   : ${runInfo.promptName}`);
    lines.push(
      `Settings : vision=${runInfo.visionEnabled ? "on" : "off"}, termination=${runInfo.terminationMode}, max_turns=${runInfo.maxTurns}, temperature=${runInfo.temperature}`,
    );
  }
  lines.push(`Result   : ${status ? STATUS_TEXT[status.status] + (status.detail ? ` (${status.detail})` : "") : "(未完了)"}`);
  lines.push(`Turns    : ${turns.length}`);
  lines.push("");

  if (runInfo) {
    lines.push("=".repeat(60), "System Prompt (template)", "=".repeat(60), runInfo.systemPrompt.trim(), "");
    lines.push("=".repeat(60), "Feedback Prompt (template)", "=".repeat(60), runInfo.feedbackPrompt.trim(), "");
  }

  for (const t of turns) {
    lines.push("=".repeat(60), `Turn ${t.turn}`, "=".repeat(60));
    lines.push(section(`入力${t.inputFrames ? "(画像あり)" : ""}`, t.inputText));
    lines.push(section("生成", t.llmRaw));
    if (t.code === null) {
      lines.push("[実行] コードなし(実行されませんでした)\n");
      continue;
    }
    lines.push(section("stdout", t.stdout));
    lines.push(section("stderr", t.stderr));
    if (t.taskCompleted !== null) lines.push(`[task_completed] ${t.taskCompleted}\n`);
    const steps = t.perceptionSteps ?? [];
    if (steps.length > 0) {
      lines.push("[Perception]");
      for (const s of steps) {
        lines.push(`- ${s.tool_name}${s.text ? `: ${s.text.replace(/\s+$/, "")}` : ""}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n") + "\n";
}

export function downloadBlobUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  downloadBlobUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
