import type { AgentConfig } from "../notebooks";

interface Props {
  config: AgentConfig;
  onChange: (config: AgentConfig) => void;
  disabled: boolean;
}

// Run-level settings (not prompt text): vision, termination, turn limit,
// temperature. Prompt editing lives in AgentPromptEditor.
export default function AgentSessionSettings({ config, onChange, disabled }: Props) {
  const set = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => onChange({ ...config, [key]: value });

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
        <small className="muted">ONにすると、毎ターンのLLM呼び出しにその時点のカメラ画像(1枚)が添付されます。</small>
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
    </div>
  );
}
