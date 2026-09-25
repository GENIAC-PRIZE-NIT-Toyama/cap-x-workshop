import { useEffect, useRef, useState } from "react";
import type { PromptVersion } from "../notebooks";

interface Props {
  versions: PromptVersion[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  disabled: boolean;
}

// Dropdown for switching between prompt versions; "+ プロンプトを追加" is the
// last entry of the list itself, so adding a version is done from the same
// element you switch with.
export default function PromptVersionSelect({ versions, activeId, onSelect, onAdd, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = versions.find((v) => v.id === activeId) ?? versions[0];

  return (
    <div className="prompt-version-select" ref={rootRef}>
      <button
        type="button"
        className="prompt-version-trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="prompt-version-caption">プロンプト</span>
        <strong>{active?.name}</strong>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="prompt-version-menu" role="listbox">
          {versions.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                role="option"
                aria-selected={v.id === activeId}
                className={v.id === activeId ? "prompt-version-item active" : "prompt-version-item"}
                onClick={() => {
                  onSelect(v.id);
                  setOpen(false);
                }}
              >
                {v.name}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="prompt-version-item prompt-version-add"
              onClick={() => {
                onAdd();
                setOpen(false);
              }}
            >
              + プロンプトを追加
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
