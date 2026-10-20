import { useTranslations } from "next-intl";

export type ViewMode = "graph" | "list";

const MODES: ViewMode[] = ["graph", "list"];

export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const t = useTranslations("plsqlWorkspace.viewMode");
  return (
    <div
      role="group"
      aria-label={t("group")}
      className="inline-flex items-center gap-0.5 rounded-full border bg-surface p-0.5"
    >
      {MODES.map((entry) => {
        const active = entry === mode;
        return (
          <button
            key={entry}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(entry)}
            className={`min-h-8 rounded-full px-3 py-1 text-sm font-medium ${
              active
                ? "bg-selected text-primary"
                : "text-text-secondary hover:bg-background"
            }`}
          >
            {t(entry)}
          </button>
        );
      })}
    </div>
  );
}
