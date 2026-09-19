import { useState, useEffect, useRef } from "react";

interface Props {
  frames: Record<string, string>;
  replayFrames?: { camera: string; image: string }[];
  activeCamera: string;
  onSelectCamera: (name: string) => void;
}

export function toImageDataUrl(b64: string): string {
  if (!b64) return "";
  if (b64.startsWith("data:")) return b64;
  if (b64.startsWith("/9j/")) return `data:image/jpeg;base64,${b64}`;
  if (b64.startsWith("UklGR")) return `data:image/webp;base64,${b64}`;
  return `data:image/png;base64,${b64}`;
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
          <CanvasFrameView key={current} base64Image={frames[current]} alt={current} />
        ) : (
          <div className="camera-placeholder">映像はまだありません</div>
        )}
      </div>
    </div>
  );
}

function CanvasFrameView({ base64Image, alt }: { base64Image: string; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!base64Image) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let active = true;
    const img = new Image();
    img.onload = () => {
      if (!active) return;
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
      }
    };
    img.src = toImageDataUrl(base64Image);

    return () => {
      active = false;
    };
  }, [base64Image]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={alt}
      width={512}
      height={512}
      style={{ width: "100%", height: "auto", display: "block" }}
    />
  );
}

function ReplayPlayer({ frames }: { frames: { camera: string; image: string }[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const delay = index === frames.length - 1 ? 1000 : 50;
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, delay);
    
    return () => clearTimeout(timer);
  }, [playing, index, frames.length]);

  return (
    <div className="replay-player">
      <CanvasFrameView base64Image={frames[index]?.image} alt="replay" />
      <div className="replay-controls">
        <button onClick={() => setPlaying(!playing)} style={{ width: "80px", cursor: "pointer" }}>{playing ? "⏸ 停止" : "▶ 再生"}</button>
        <button onClick={() => { setPlaying(false); setIndex((i) => Math.max(0, i - 1)); }} style={{ cursor: "pointer" }}>❘◀</button>
        <button onClick={() => { setPlaying(false); setIndex((i) => Math.min(Math.max(0, frames.length - 1), i + 1)); }} style={{ cursor: "pointer" }}>▶❘</button>
        <input 
          type="range" 
          min={0} 
          max={Math.max(0, frames.length - 1)} 
          value={Math.min(index, Math.max(0, frames.length - 1))} 
          onChange={(e) => { setPlaying(false); setIndex(parseInt(e.target.value, 10)); }} 
          style={{ flex: 1, cursor: "pointer" }}
        />
        <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text)" }}>{index + 1} / {frames.length}</span>
      </div>
    </div>
  );
}
