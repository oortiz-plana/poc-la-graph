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
    <div role="group" aria-label="View mode" className="flex gap-1">
      {MODES.map((entry) => {
        const active = entry.value === mode;
        return (
          <button
            key={entry.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(entry.value)}
            className={`min-h-9 rounded-full border px-3 py-1 text-sm font-medium ${
              active
                ? "border-transparent bg-selected text-primary"
                : "bg-surface text-text-secondary hover:bg-background"
            }`}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
