// Only affects how the shortcut is *described* in tooltips — both ⌘ and
// Ctrl are accepted everywhere, so a wrong guess here changes no behavior.
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export const RUN_SHORTCUT_LABEL = isMac ? "⌘+Enter" : "Ctrl+Enter";

export function isRunShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}
