type RepRow = {
  ownerId: string | null;
  ownerName: string;
  enrolled: number;
  callsMade: number;
  connects: number;
  replies: number;
  meetings: number;
};

export function RepBreakdownTable({ rows }: { rows: RepRow[] }) {
  const maxEnrolled = Math.max(1, ...rows.map((r) => r.enrolled));

  return (
    <div className="hud-panel">
      <div className="overflow-x-auto rounded-lg">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="hud-heading border-b text-xs" style={{ borderColor: "var(--border-hairline)" }}>
            <th className="px-4 py-3 font-medium">Rep</th>
            <th className="px-4 py-3 font-medium">Enrolled</th>
            <th className="px-4 py-3 font-medium">Calls Made</th>
            <th className="px-4 py-3 font-medium">Connects</th>
            <th className="px-4 py-3 font-medium">Replies</th>
            <th className="px-4 py-3 font-medium">Meetings</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                No data
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.ownerId ?? "unassigned"}
              className="border-t"
              style={{ borderColor: "var(--gridline)" }}
            >
              <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
                <div className="flex items-center gap-3">
                  <span
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.max(8, (r.enrolled / maxEnrolled) * 48)}px`,
                      background: "var(--series-blue)",
                    }}
                    aria-hidden
                  />
                  {r.ownerName}
                </div>
              </td>
              <td className="px-4 py-3 tabular-nums">{r.enrolled}</td>
              <td className="px-4 py-3 tabular-nums">{r.callsMade}</td>
              <td className="px-4 py-3 tabular-nums">{r.connects}</td>
              <td className="px-4 py-3 tabular-nums">{r.replies}</td>
              <td className="px-4 py-3 tabular-nums">{r.meetings}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
