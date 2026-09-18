export type PromptLang = "ja" | "en";

interface Props {
  prompt: string;
  promptJa: string | null;
  lang: PromptLang;
  onChangeLang: (lang: PromptLang) => void;
}

// The English prompt is what the environment actually uses; the Japanese
// one is a reading aid (config.py's prompt_ja). No Japanese → no switch.
export default function TaskPromptBanner({ prompt, promptJa, lang, onChangeLang }: Props) {
  const showJa = lang === "ja" && promptJa !== null;
  return (
    <div className="task-prompt">
      <p className="task-prompt-text">{showJa ? promptJa : prompt}</p>
      {promptJa !== null && (
        <div className="task-prompt-lang" role="radiogroup" aria-label="プロンプトの言語">
          <button
            type="button"
            className={lang === "ja" ? "task-prompt-lang-btn active" : "task-prompt-lang-btn"}
            aria-pressed={lang === "ja"}
            onClick={() => onChangeLang("ja")}
          >
            日本語
          </button>
          <button
            type="button"
            className={lang === "en" ? "task-prompt-lang-btn active" : "task-prompt-lang-btn"}
            aria-pressed={lang === "en"}
            onClick={() => onChangeLang("en")}
          >
            EN
          </button>
        </div>
      )}
    </div>
  );
}
