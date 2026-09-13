import type { PerceptionStep } from "../types";

interface Props {
  visible: boolean;
  onToggle: () => void;
  steps: PerceptionStep[];
}

// Off by default (see WORKSHOP_WEBUI_SPEC.md section 1.4): participants focus
// on their code and the camera view, and open this panel only when they want
// to see what SAM3/GraspNet/PyRoKi actually returned for a given call.
export default function PerceptionPanel({ visible, onToggle, steps }: Props) {
  return (
    <div className="perception-panel">
      <div className="perception-header">
        <h3>Perceptionビュー</h3>
        <label className="toggle">
          <input type="checkbox" checked={visible} onChange={onToggle} />
          表示
        </label>
      </div>
      {visible && (
        <div className="perception-steps">
          {steps.length === 0 && <p className="muted">まだPerception APIは呼ばれていません。</p>}
          {steps.map((step, i) => (
            <div key={i} className={step.highlight ? "perception-step highlight" : "perception-step"}>
              <div className="perception-step-title">{step.tool_name}</div>
              <div className="perception-step-text">{step.text}</div>
              {step.images.length > 0 && (
                <div className="perception-step-images">
                  {step.images.map((img, j) => (
                    <img key={j} src={`data:image/jpeg;base64,${img}`} alt={`${step.tool_name} ${j}`} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
