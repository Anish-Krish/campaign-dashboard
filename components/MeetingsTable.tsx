type MeetingRow = {
  hubspotContactId: string;
  name: string;
  jobTitle: string | null;
  companyName: string | null;
  meetingOutcomeLabel: string;
  lastMeetingAt: Date | null;
  sqoReached: boolean;
  sqlReached: boolean;
  ownerName: string;
  hubspotUrl: string;
};

export function MeetingsTable({ rows }: { rows: MeetingRow[] }) {
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ background: "var(--chart-surface)", borderColor: "var(--border-hairline)" }}
    >
      <table className="w-full text-left text-sm">
        <thead>
          <tr style={{ color: "var(--text-secondary)" }} className="border-b">
            <th className="px-4 py-3 font-medium" style={{ borderColor: "var(--border-hairline)" }}>
              Contact
            </th>
            <th className="px-4 py-3 font-medium">Company</th>
            <th className="px-4 py-3 font-medium">Meeting Outcome</th>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">SQO</th>
            <th className="px-4 py-3 font-medium">SQL</th>
            <th className="px-4 py-3 font-medium">Owner</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                No meetings or opportunities yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.hubspotContactId} className="border-t" style={{ borderColor: "var(--gridline)" }}>
              <td className="px-4 py-3">
                <a
                  href={r.hubspotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                  style={{ color: "var(--series-blue)" }}
                >
                  {r.name}
                </a>
                {r.jobTitle && (
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {r.jobTitle}
                  </div>
                )}
              </td>
              <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                {r.companyName ?? "—"}
              </td>
              <td className="px-4 py-3">{r.meetingOutcomeLabel}</td>
              <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                {r.lastMeetingAt ? new Date(r.lastMeetingAt).toLocaleDateString() : "—"}
              </td>
              <td className="px-4 py-3">
                {r.sqoReached ? (
                  <span style={{ color: "var(--series-aqua)" }}>Yes</span>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>—</span>
                )}
              </td>
              <td className="px-4 py-3">
                {r.sqlReached ? (
                  <span style={{ color: "var(--series-blue)" }}>Yes</span>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>—</span>
                )}
              </td>
              <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                {r.ownerName}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
