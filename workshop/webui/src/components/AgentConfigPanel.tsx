import { useState } from "react";
import { previewAgentPrompt } from "../api";
import type { AgentConfig } from "../notebooks";

interface Props {
  config: AgentConfig;
  onChange: (config: AgentConfig) => void;
  disabled: boolean;
  // Real values from the running session, used both to seed a template's
  // variables and as the "real data" half of the preview toggle below.
  taskInstruction: string;
  apiDocument: string;
  // The most recently completed turn's stdout/stderr (if any) — used the
  // same way, for previewing the Feedback Prompt against something real
  // instead of only dummy placeholders.
  lastStdout: string | null;
  lastStderr: string | null;
}

// Dummy stand-ins for the Feedback Prompt's per-turn variables, shown before
// any turn has actually run yet (see the preview button below) — picked to
// look obviously like placeholders so they're never mistaken for real
// output.
const DUMMY_STDOUT = "(実行結果はまだありません — ダミー値です)\nposition: [0.42, 0.11, 0.18]";
const DUMMY_STDERR = "";

type PreviewTarget = "system" | "feedback";

export default function AgentConfigPanel({
  config,
  onChange,
  disabled,
  taskInstruction,
  apiDocument,
  lastStdout,
  lastStderr,
}: Props) {
  const [previewing, setPreviewing] = useState<PreviewTarget | null>(null);
  const [previewResult, setPreviewResult] = useState<{ target: PreviewTarget; text: string; isError: boolean } | null>(
    null,
  );

  const set = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => onChange({ ...config, [key]: value });

  const handlePreview = async (target: PreviewTarget) => {
    setPreviewing(target);
    setPreviewResult(null);
    const template = target === "system" ? config.systemPrompt : config.feedbackPrompt;
    const variables =
      target === "system"
        ? { task_instruction: taskInstruction, api_document: apiDocument }
        : {
            task_instruction: taskInstruction,
            api_document: apiDocument,
            stdout: lastStdout ?? DUMMY_STDOUT,
            stderr: lastStderr ?? DUMMY_STDERR,
            turn: 1,
            max_turns: config.maxTurns,
            is_task_completed: null,
          };
    try {
      const res = await previewAgentPrompt(template, variables);
      if (res.error) {
        setPreviewResult({ target, text: res.error, isError: true });
      } else {
        setPreviewResult({ target, text: res.rendered ?? "", isError: false });
      }
    } catch (err) {
      setPreviewResult({ target, text: String(err), isError: true });
    } finally {
      setPreviewing(null);
    }
  };

  return (
    <div className="agent-config">
      <div className="agent-config-row">
        <label className="agent-toggle">
          <input
            type="checkbox"
            checked={config.visionEnabled}
            onChange={(e) => set("visionEnabled", e.target.checked)}
            disabled={disabled}
          />
          画像入力(Vision)を有効にする
        </label>
        <small className="muted">
          ONにすると、毎ターンのLLM呼び出しにその時点のカメラ画像(1枚)が添付されます。
        </small>
      </div>

      <div className="agent-config-row">
        <span className="agent-config-label">終了条件</span>
        <div className="agent-radio-group" role="radiogroup" aria-label="終了条件">
          <label className="agent-radio">
            <input
              type="radio"
              name="termination-mode"
              checked={config.terminationMode === "agent"}
              onChange={() => set("terminationMode", "agent")}
              disabled={disabled}
            />
            Agentが判断(推奨)
            <small>コードブロックを出力しなくなったら終了。タスク完了はAgent自身がPerception等で確認する必要があります。</small>
          </label>
          <label className="agent-radio">
            <input
              type="radio"
              name="termination-mode"
              checked={config.terminationMode === "simulation"}
              onChange={() => set("terminationMode", "simulation")}
              disabled={disabled}
            />
            シミュレーション結果で判定
            <small>シミュレータが task_completed を返したら自動的に終了します(答え合わせ用)。</small>
          </label>
        </div>
      </div>

      <div className="agent-config-row agent-config-row-inline">
        <label>
          max turns
          <input
            type="number"
            min={1}
            max={30}
            value={config.maxTurns}
            onChange={(e) => set("maxTurns", Math.max(1, Number(e.target.value)))}
            disabled={disabled}
          />
        </label>
        <label>
          temperature
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={config.settings.temperature}
            onChange={(e) => set("settings", { ...config.settings, temperature: Number(e.target.value) })}
            disabled={disabled}
          />
        </label>
      </div>

      <PromptTemplateEditor
        label="System Prompt"
        hint="最初のターンでLLMに送られます。{{ task_instruction }} と {{ api_document }} が使えます。"
        value={config.systemPrompt}
        onChangeValue={(v) => set("systemPrompt", v)}
        disabled={disabled}
        previewing={previewing === "system"}
        onPreview={() => handlePreview("system")}
        previewResult={previewResult?.target === "system" ? previewResult : null}
      />

      <PromptTemplateEditor
        label="Feedback Prompt"
        hint="コード実行後、毎ターンLLMに送られます。{{ stdout }} {{ stderr }} {{ turn }} {{ max_turns }} {{ is_task_completed }} {{ task_instruction }} {{ api_document }} が使えます。"
        value={config.feedbackPrompt}
        onChangeValue={(v) => set("feedbackPrompt", v)}
        disabled={disabled}
        previewing={previewing === "feedback"}
        onPreview={() => handlePreview("feedback")}
        previewResult={previewResult?.target === "feedback" ? previewResult : null}
      />
    </div>
  );
}

function PromptTemplateEditor({
  label,
  hint,
  value,
  onChangeValue,
  disabled,
  previewing,
  onPreview,
  previewResult,
}: {
  label: string;
  hint: string;
  value: string;
  onChangeValue: (v: string) => void;
  disabled: boolean;
  previewing: boolean;
  onPreview: () => void;
  previewResult: { text: string; isError: boolean } | null;
}) {
  return (
    <div className="agent-template-editor">
      <div className="prompt-header-row">
        <div className="prompt-turn-label">{label}</div>
        <button type="button" className="copy-btn" onClick={onPreview} disabled={previewing}>
          {previewing ? "描画中..." : "プレビュー"}
        </button>
      </div>
      <small className="muted">{hint}</small>
      <textarea
        className="prompt-editor agent-template-textarea"
        value={value}
        onChange={(e) => onChangeValue(e.target.value)}
        disabled={disabled}
        spellCheck={false}
      />
      {previewResult && (
        <pre className={previewResult.isError ? "agent-preview-output error" : "agent-preview-output"}>
          {previewResult.text}
        </pre>
      )}
    </div>
  );
}
