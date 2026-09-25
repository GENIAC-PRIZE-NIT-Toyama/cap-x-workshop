import { useLayoutEffect, useRef, useState } from "react";
import { previewAgentPrompt } from "../api";
import { activePrompt, type AgentConfig, type PromptVersion } from "../notebooks";

interface Props {
  config: AgentConfig;
  onChange: (config: AgentConfig) => void;
  disabled: boolean;
  // Real values from the running session, used both to seed a template's
  // variables and as the "real data" half of the preview.
  taskInstruction: string;
  apiDocument: string;
  // The most recently completed turn's stdout/stderr (if any), for
  // previewing the Feedback Prompt against something real.
  lastStdout: string | null;
  lastStderr: string | null;
}

// Dummy stand-ins for the Feedback Prompt's per-turn variables, shown before
// any turn has actually run yet.
const DUMMY_STDOUT = "(実行結果はまだありません — ダミー値です)\nposition: [0.42, 0.11, 0.18]";
const DUMMY_STDERR = "";

type PreviewTarget = "system" | "feedback";

// Edits the *active* prompt version's System/Feedback templates.
export default function AgentPromptEditor({
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

  const version = activePrompt(config);
  const patchVersion = (patch: Partial<PromptVersion>) =>
    onChange({
      ...config,
      promptVersions: config.promptVersions.map((v) => (v.id === version.id ? { ...v, ...patch } : v)),
    });

  const deleteVersion = () => {
    if (config.promptVersions.length <= 1) return;
    if (!window.confirm(`プロンプト「${version.name}」を削除しますか?`)) return;
    const rest = config.promptVersions.filter((v) => v.id !== version.id);
    onChange({ ...config, promptVersions: rest, activePromptId: rest[0].id });
  };

  const handlePreview = async (target: PreviewTarget) => {
    setPreviewing(target);
    setPreviewResult(null);
    const template = target === "system" ? version.systemPrompt : version.feedbackPrompt;
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
      <div className="agent-config-row agent-config-row-inline prompt-version-meta">
        <label>
          プロンプト名
          <input
            type="text"
            value={version.name}
            onChange={(e) => patchVersion({ name: e.target.value })}
            disabled={disabled}
          />
        </label>
        <button
          type="button"
          className="copy-btn"
          onClick={deleteVersion}
          disabled={disabled || config.promptVersions.length <= 1}
        >
          このプロンプトを削除
        </button>
      </div>

      <PromptTemplateEditor
        label="System Prompt"
        hint="最初のターンでLLMに送られます。{{ task_instruction }} と {{ api_document }} が使えます。"
        value={version.systemPrompt}
        onChangeValue={(v) => patchVersion({ systemPrompt: v })}
        disabled={disabled}
        previewing={previewing === "system"}
        onPreview={() => handlePreview("system")}
        previewResult={previewResult?.target === "system" ? previewResult : null}
      />

      <PromptTemplateEditor
        label="Feedback Prompt"
        hint="コード実行後、毎ターンLLMに送られます。{{ stdout }} {{ stderr }} {{ turn }} {{ max_turns }} {{ is_task_completed }} {{ task_instruction }} {{ api_document }} が使えます。"
        value={version.feedbackPrompt}
        onChangeValue={(v) => patchVersion({ feedbackPrompt: v })}
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
  // Grows with content and never caps/scrolls internally — participants
  // asked to always see the whole prompt they're editing. Reset to auto
  // first so deleting lines shrinks it back down.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

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
        ref={textareaRef}
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
