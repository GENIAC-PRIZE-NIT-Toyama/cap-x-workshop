import { useEffect, useRef, useState } from "react";

export type PromptLang = "ja" | "en";

const LANG_LABELS: Record<PromptLang, string> = { ja: "日本語", en: "English" };
const LANGS: PromptLang[] = ["ja", "en"];

interface Props {
  prompt: string;
  promptJa: string | null;
  lang: PromptLang;
  onChangeLang: (lang: PromptLang) => void;
}

// The English prompt is what the environment actually uses; the Japanese
// one is a reading aid (config.py's prompt_ja). No Japanese → no switch.
export default function TaskPromptBanner({ prompt, promptJa, lang, onChangeLang }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const showJa = lang === "ja" && promptJa !== null;
  return (
    <div className="task-prompt">
      <p className="task-prompt-text">{showJa ? promptJa : prompt}</p>
      {promptJa !== null && (
        <div className="task-prompt-lang" ref={menuRef}>
          <button
            type="button"
            className="task-prompt-lang-btn"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label="プロンプトの言語"
            onClick={() => setOpen((o) => !o)}
          >
            {LANG_LABELS[lang]} <span className="task-prompt-lang-caret" aria-hidden="true">▼</span>
          </button>
          {open && (
            <ul className="task-prompt-lang-menu" role="listbox" aria-label="プロンプトの言語">
              {LANGS.map((l) => (
                <li key={l} role="option" aria-selected={l === lang}>
                  <button
                    type="button"
                    className={l === lang ? "task-prompt-lang-option active" : "task-prompt-lang-option"}
                    onClick={() => {
                      onChangeLang(l);
                      setOpen(false);
                    }}
                  >
                    {LANG_LABELS[l]}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
