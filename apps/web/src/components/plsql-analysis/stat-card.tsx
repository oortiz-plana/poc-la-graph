export function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border bg-surface px-4 py-3">
      <dd className="text-2xl font-semibold">{value}</dd>
      <dt className="text-xs text-text-secondary">{label}</dt>
    </div>
  );
}
