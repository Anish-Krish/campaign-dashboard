import { GaugeRing } from "@/components/GaugeRing";

export function StatTile({
  label,
  value,
  percent,
}: {
  label: string;
  value: string | number;
  percent?: number;
}) {
  return (
    <div className="hud-panel flex items-center justify-between gap-3 p-4">
      <div>
        <div className="hud-heading text-xs">{label}</div>
        <div
          className="mt-1 text-3xl font-semibold tabular-nums"
          style={{ color: "var(--text-primary)" }}
        >
          {value}
        </div>
      </div>
      {percent != null && <GaugeRing percent={percent} />}
    </div>
  );
}

export function StatTileRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
  );
}
