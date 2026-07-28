import Link from "next/link";

type CampaignRow = {
  id: number;
  name: string;
  ownerName: string | null;
  targetCount: number | null;
  delivered: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

export function CampaignsTable({ rows }: { rows: CampaignRow[] }) {
  return (
    <div className="hud-panel">
      <div className="overflow-x-auto rounded-lg">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="hud-heading border-b text-xs" style={{ borderColor: "var(--border-hairline)" }}>
            <th className="px-4 py-3 font-medium">Campaign Name</th>
            <th className="px-4 py-3 font-medium">Owner</th>
            <th className="px-4 py-3 font-medium">Target</th>
            <th className="px-4 py-3 font-medium">Delivered</th>
            <th className="px-4 py-3 font-medium">Remaining</th>
            <th className="px-4 py-3 font-medium">Start Date</th>
            <th className="px-4 py-3 font-medium">End Date</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                No campaigns yet — add one in Settings.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const remaining = r.targetCount != null ? Math.max(0, r.targetCount - r.delivered) : null;
            return (
              <tr key={r.id} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                <td className="px-4 py-3">
                  <Link
                    href={`/campaigns/${r.id}`}
                    className="font-medium hover:underline"
                    style={{ color: "var(--series-blue)" }}
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                  {r.ownerName ?? "—"}
                </td>
                <td className="px-4 py-3 tabular-nums">{r.targetCount ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums">{r.delivered}</td>
                <td className="px-4 py-3 tabular-nums">{remaining ?? "—"}</td>
                <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                  {fmtDate(r.startDate)}
                </td>
                <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                  {fmtDate(r.endDate)}
                </td>
                <td className="px-4 py-3 capitalize" style={{ color: "var(--text-secondary)" }}>
                  {r.status}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
