import { useState } from "react";

interface Props {
  frames: Record<string, string>;
}

export default function CameraView({ frames }: Props) {
  const cameraNames = Object.keys(frames);
  const [active, setActive] = useState<string | null>(null);
  const current = active && frames[active] ? active : cameraNames[0];

  return (
    <div className="camera-view">
      <div className="camera-tabs">
        {cameraNames.map((name) => (
          <button
            key={name}
            className={name === current ? "camera-tab active" : "camera-tab"}
            onClick={() => setActive(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="camera-frame">
        {current && frames[current] ? (
          <img src={`data:image/png;base64,${frames[current]}`} alt={current} />
        ) : (
          <div className="camera-placeholder">映像はまだありません</div>
        )}
      </div>
    </div>
  );
}
