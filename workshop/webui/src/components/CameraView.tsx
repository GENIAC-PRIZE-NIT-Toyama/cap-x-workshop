import { useState, useEffect } from "react";

interface Props {
  frames: Record<string, string>;
  replayFrames?: { camera: string; image: string }[];
  activeCamera: string;
  onSelectCamera: (name: string) => void;
}

export default function CameraView({ frames, replayFrames, activeCamera, onSelectCamera }: Props) {
  const cameraNames = Object.keys(frames);
  if (replayFrames && replayFrames.length > 0 && !cameraNames.includes("replay")) {
    cameraNames.push("replay");
  }

  const current = cameraNames.includes(activeCamera) ? activeCamera : cameraNames[0];

  return (
    <div className="camera-view">
      <div className="camera-tabs">
        {cameraNames.map((name) => (
          <button
            key={name}
            className={name === current ? "camera-tab active" : "camera-tab"}
            onClick={() => onSelectCamera(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="camera-frame">
        {current === "replay" && replayFrames && replayFrames.length > 0 ? (
          <ReplayPlayer frames={replayFrames} />
        ) : current && frames[current] ? (
          <img src={`data:image/png;base64,${frames[current]}`} alt={current} style={{ width: "100%", display: "block" }} />
        ) : (
          <div className="camera-placeholder">映像はまだありません</div>
        )}
      </div>
    </div>
  );
}

function ReplayPlayer({ frames }: { frames: { camera: string; image: string }[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const delay = index === frames.length - 1 ? 1000 : 150;
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, delay);
    
    return () => clearTimeout(timer);
  }, [playing, index, frames.length]);

  return (
    <div className="replay-player">
      <img src={`data:image/png;base64,${frames[index]?.image}`} style={{ width: "100%", display: "block" }} />
      <div className="replay-controls">
        <button onClick={() => setPlaying(!playing)} style={{ width: "80px", cursor: "pointer" }}>{playing ? "⏸ 停止" : "▶ 再生"}</button>
        <button onClick={() => { setPlaying(false); setIndex((i) => Math.max(0, i - 1)); }} style={{ cursor: "pointer" }}>❘◀</button>
        <button onClick={() => { setPlaying(false); setIndex((i) => Math.min(frames.length - 1, i + 1)); }} style={{ cursor: "pointer" }}>▶❘</button>
        <input 
          type="range" 
          min={0} 
          max={frames.length - 1} 
          value={index} 
          onChange={(e) => { setPlaying(false); setIndex(parseInt(e.target.value, 10)); }} 
          style={{ flex: 1, cursor: "pointer" }}
        />
        <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text)" }}>{index + 1} / {frames.length}</span>
      </div>
    </div>
  );
}
