const formateador = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

interface StatTileProps {
  label: string;
  value: number | null;
  tone?: "neutral" | "good" | "critical";
}

export function StatTile({ label, value, tone = "neutral" }: StatTileProps) {
  const colorPorTono: Record<string, string> = {
    neutral: "var(--text-primary)",
    good: "var(--status-good)",
    critical: "var(--status-critical)",
  };

  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {label}
      </div>
      <div
        className="mt-1 text-2xl font-semibold"
        style={{ color: colorPorTono[tone] }}
      >
        {value === null ? "—" : formateador.format(value)}
      </div>
    </div>
  );
}
