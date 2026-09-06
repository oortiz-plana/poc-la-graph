export type ViewMode = "graph" | "list";

const MODES: { value: ViewMode; label: string }[] = [
  { value: "graph", label: "Graph" },
  { value: "list", label: "List" },
];

export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center gap-0.5 rounded-full border bg-surface p-0.5"
    >
      {MODES.map((entry) => {
        const active = entry.value === mode;
        return (
          <button
            key={entry.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(entry.value)}
            className={`min-h-8 rounded-full px-3 py-1 text-sm font-medium ${
              active
                ? "bg-selected text-primary"
                : "text-text-secondary hover:bg-background"
            }`}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
