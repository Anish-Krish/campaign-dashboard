import Link from "next/link";
import type { ActivatedLead, Booking } from "@/lib/team-queries";
import { ActivatedList, BookingList } from "./PerformanceView";

// The BDR follow-up flow (per the user): what each rep has to chase right now,
// independent of the period — meetings to rebook, activated leads to turn into
// a booked meeting, and meetings still missing an outcome.

export type FollowUpRep = { ownerId: string; name: string; href: string };

function Count({ label, n, tone, hint }: { label: string; n: number; tone: string; hint: string }) {
  return (
    <div className="card relative overflow-hidden p-5" title={hint}>
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: n > 0 ? tone : "var(--gridline)" }} aria-hidden />
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-[34px] font-semibold leading-none tabular-nums" style={{ color: "var(--text-primary)" }}>
        {n}
      </div>
      <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {hint}
      </div>
    </div>
  );
}

function Panel({ title, n, children }: { title: string; n: number; children: React.ReactNode }) {
  return (
    <section className="card flex max-h-[720px] flex-col overflow-hidden">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-2" style={{ borderBottom: "1px solid var(--border-hairline)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h2>
        <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
          {n}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-5">{children}</div>
    </section>
  );
}

export function FollowUps({
  attention,
  activated,
  reps,
  focused,
}: {
  attention: Booking[];
  activated: ActivatedLead[];
  reps: FollowUpRep[]; // current reps, for the per-rep summary (team view only)
  focused: boolean;
}) {
  // Team view = current reps only (a former rep's leftovers aren't anyone's to-do).
  const mine = (ownerId: string) => focused || reps.some((r) => r.ownerId === ownerId);
  const todo = attention.filter((b) => mine(b.ownerId));
  const leads = activated.filter((a) => mine(a.ownerId));
  const rebook = todo.filter((b) => b.meetingStatus === "needs_rebook");
  const outcome = todo.filter((b) => b.meetingStatus === "not_logged" || (b.checkFlag && b.meetingStatus !== "needs_rebook"));

  const perRep = reps
    .map((r) => ({
      ...r,
      rebook: rebook.filter((b) => b.ownerId === r.ownerId).length,
      activated: leads.filter((a) => a.ownerId === r.ownerId).length,
      outcome: outcome.filter((b) => b.ownerId === r.ownerId).length,
    }))
    .map((r) => ({ ...r, total: r.rebook + r.activated + r.outcome }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Count
          label="To rebook"
          n={rebook.length}
          tone="var(--status-warning)"
          hint="No-show or cancel, company still open"
        />
        <Count
          label="Activated · book the meeting"
          n={leads.length}
          tone="var(--accent)"
          hint="Lead Status Open Deal, no deal yet"
        />
        <Count
          label="Set the outcome"
          n={outcome.length}
          tone="var(--status-warning)"
          hint="Meeting passed with no outcome, or the outcome disagrees with the recording"
        />
      </div>

      {!focused && perRep.length > 0 && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th>To rebook</th>
                <th>Activated</th>
                <th>Set outcome</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {perRep.map((r) => (
                <tr key={r.ownerId} className="clickable">
                  <td>
                    <Link href={r.href} className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
                      {r.name}
                    </Link>
                  </td>
                  <td>{r.rebook}</td>
                  <td>{r.activated}</td>
                  <td>{r.outcome}</td>
                  <td className="key">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <Panel title="Rebook these meetings" n={rebook.length}>
          <p className="pt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            Book a new meeting, then set the old one&apos;s outcome to Rescheduled. If they&apos;re not interested, set the
            company or contact Lead Status to Not Interested and it moves to lost.
          </p>
          <BookingList rows={rebook} empty="Nothing to rebook." showWaiting />
        </Panel>
        <Panel title="Activated leads · book the meeting" n={leads.length}>
          <p className="pt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            Marked Open Deal with no deal yet. Book the intro and create the deal; it drops off this list on the next sync.
          </p>
          <ActivatedList rows={leads} empty="No activated leads waiting." showRep={!focused} />
        </Panel>
        <Panel title="Set the meeting outcome" n={outcome.length}>
          <p className="pt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            Set Completed, No show, Canceled or Rescheduled on the meeting in HubSpot. BDRs also get an email an hour after
            the meeting if it&apos;s still blank.
          </p>
          <BookingList rows={outcome} empty="Every meeting has an outcome." />
        </Panel>
      </div>
    </div>
  );
}
