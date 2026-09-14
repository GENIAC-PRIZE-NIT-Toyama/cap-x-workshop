import type { PerceptionStep } from "../types";

interface Props {
  steps: PerceptionStep[];
}

// Always visible: participants asked to see this by default, not opt into
// it, since watching what SAM3/GraspNet/PyRoKi actually return is a big part
// of the point of the workshop.
export default function PerceptionPanel({ steps }: Props) {
  return (
    <div className="perception-panel">
      <div className="perception-header">
        <h3>Perceptionビュー</h3>
      </div>
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
    </div>
  );
}
