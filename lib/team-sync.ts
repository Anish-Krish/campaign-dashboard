import { db } from "@/lib/db";
import { teamCallDaily, teamDeals } from "@/lib/db/schema";
import { and, eq, gte, notInArray, sql } from "drizzle-orm";
import {
  batchReadAssociations,
  batchReadObjects,
  batchReadObjectsWithHistory,
  getCallDispositionOptions,
  searchAll,
  type SearchFilter,
} from "@/lib/hubspot";
import { toTorontoDateStr, todayInToronto } from "@/lib/timezone";

// Portal-specific pipeline/stage IDs, verified live via GET /crm/v3/pipelines/deals.
const MARKETING_PIPELINE_ID = "62788164";
const SALES_PIPELINE_ID = "default";
// MQL = the deal reached Pre-Assessment Questions (per the user), or anything
// past it: System Overview, or any Sales Pipeline stage. MQL date is the first
// time the deal entered one of these. A deal only gets here after the intro
// meeting happened, so it also implies "held".
const MQL_STAGES = new Set([
  "1129362176", // Pre-Assessment Questions
  "1129362177", // System Overview
  "102677034", // Discovery
  "109814654", // Investment Summary
  "presentationscheduled",
  "decisionmakerboughtin",
  "contractsent",
  "closedwon",
  "closedlost", // Sales Pipeline's closed lost (Marketing's is 123017108)
]);

// Intro Meeting Status (deal property `intro_meeting_status`, created for this
// dashboard): set by hand after each intro meeting. These four are final
// answers and always win over anything inferred from meeting records.
const MANUAL_FINAL_STATUSES = new Set(["held", "needs_rebook", "no_show_lost", "cancelled_lost"]);

// How far before a deal's creation a contact's meeting can have been created
// and still count as that deal's intro meeting — BDRs book the meeting first
// and create the deal minutes-to-days later (e.g. Globe Printers: meeting
// 19:09, deal 19:12, and the meeting was never associated to the deal).
const MEETING_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// UTC instant of 00:00 Toronto time on `day` (Toronto is UTC-4 in EDT, UTC-5
// in EST — try both and keep the one that actually lands on the day boundary).
function torontoMidnightUtcMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  for (const offsetHours of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, offsetHours);
    if (toTorontoDateStr(ms) === day && toTorontoDateStr(ms - 1) !== day) return ms;
  }
  return Date.UTC(y, m - 1, d, 5);
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

type CallProps = {
  hs_timestamp?: string;
  hubspot_owner_id?: string;
  hs_call_disposition?: string;
  hs_call_direction?: string;
};

// Fetches every call in [fromMs, toMs), halving the window whenever a single
// query would exceed HubSpot search's 10k paging cap.
async function fetchCallsInWindow(fromMs: number, toMs: number): Promise<CallProps[]> {
  const filters: SearchFilter[] = [
    { propertyName: "hs_timestamp", operator: "GTE", value: String(fromMs) },
    { propertyName: "hs_timestamp", operator: "LT", value: String(toMs) },
  ];
  const { overflow, results } = await searchAll<CallProps>("calls", filters, [
    "hs_timestamp",
    "hubspot_owner_id",
    "hs_call_disposition",
    "hs_call_direction",
  ]);
  if (!overflow) return results.map((r) => r.properties);
  const mid = Math.floor((fromMs + toMs) / 2);
  return [...(await fetchCallsInWindow(fromMs, mid)), ...(await fetchCallsInWindow(mid, toMs))];
}

// Recomputes team_call_daily for every Toronto day in [fromDay, toDay]
// (inclusive). Whole days are replaced, so re-running is always safe.
export async function syncTeamCalls(fromDay: string, toDay: string, log: (msg: string) => void = () => {}) {
  const dispositions = await getCallDispositionOptions();
  const labelById = new Map(dispositions.map((d) => [d.value, d.label]));

  let total = 0;
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    const calls = await fetchCallsInWindow(torontoMidnightUtcMs(day), torontoMidnightUtcMs(addDays(day, 1)));

    const counts = new Map<string, typeof teamCallDaily.$inferInsert>();
    for (const c of calls) {
      const ownerId = c.hubspot_owner_id ?? "";
      const dispositionLabel = c.hs_call_disposition ? (labelById.get(c.hs_call_disposition) ?? "") : "";
      const direction = c.hs_call_direction ?? "";
      const key = `${ownerId}|${dispositionLabel}|${direction}`;
      const row = counts.get(key);
      if (row) row.calls += 1;
      else counts.set(key, { ownerId, day, dispositionLabel, direction, calls: 1 });
    }

    await db.transaction(async (tx) => {
      await tx.delete(teamCallDaily).where(eq(teamCallDaily.day, day));
      for (const batch of chunkArray([...counts.values()], 500)) {
        await tx.insert(teamCallDaily).values(batch);
      }
    });
    total += calls.length;
    log(`[team-sync] calls ${day}: ${calls.length}`);
  }
  return { calls: total };
}

// ---------------------------------------------------------------------------
// Deals (meetings booked, show rate, MQL/SQL, BANT)
// ---------------------------------------------------------------------------

type DealProps = {
  dealname?: string;
  pipeline?: string;
  dealstage?: string;
  createdate?: string;
  hubspot_owner_id?: string;
  sql_accepted_date?: string;
  bant_qualified?: string;
  source_group?: string;
  source?: string;
  intro_meeting_status?: string;
};

type MeetingProps = {
  hs_timestamp?: string;
  hs_createdate?: string;
  hs_meeting_outcome?: string;
  hs_meeting_title?: string;
};

const OVERVIEW_TITLE = /overview/i;

// Source Group is filled by a HubSpot workflow (seen as AUTOMATION_PLATFORM
// in its history); if it's ever blank, ZoomInfo / 6Sense sourced deals are
// BDR by definition (per the user) — anything else stays unclassified and is
// left off the Team page.
const BDR_SOURCES = new Set(["ZoomInfo", "6Sense"]);
function effectiveSourceGroup(p: { source_group?: string; source?: string }): string | null {
  if (p.source_group) return p.source_group;
  return p.source && BDR_SOURCES.has(p.source) ? "BDR" : null;
}

export type MeetingStatus =
  | "held"
  | "needs_rebook"
  | "no_show_lost"
  | "cancelled_lost"
  | "scheduled"
  | "not_logged"
  | "no_meeting";

type Meeting = MeetingProps & { id: string };
const byTimeAsc = (a: Meeting, b: Meeting) => Date.parse(a.hs_timestamp ?? "") - Date.parse(b.hs_timestamp ?? "");

// Fallback status when nobody has set Intro Meeting Status yet:
//  - any candidate meeting COMPLETED, or the deal reached MQL/SQL -> held.
//    The progression rule matters: AEs often leave the intro meeting's
//    outcome at "Scheduled" even after it clearly happened (e.g. Stallergenes
//    Greer became an SQL with its intro still marked Scheduled).
//  - otherwise the LATEST candidate meeting decides: no-show / canceled ->
//    needs_rebook (only a person can say it's lost); still scheduled in the
//    future -> scheduled; in the past -> not_logged (outcome never recorded —
//    surfaced in "Needs attention").
function deriveMeetingStatus(meetings: Meeting[], progressed: boolean, nowMs: number) {
  if (meetings.some((m) => m.hs_meeting_outcome === "COMPLETED") || progressed) {
    return { status: "held" as MeetingStatus, sinceMs: null };
  }
  if (meetings.length === 0) return { status: "no_meeting" as MeetingStatus, sinceMs: null };
  const latest = [...meetings].sort(byTimeAsc)[meetings.length - 1];
  const latestMs = Date.parse(latest.hs_timestamp ?? "");
  if (latest.hs_meeting_outcome === "NO_SHOW" || latest.hs_meeting_outcome === "CANCELED") {
    return { status: "needs_rebook" as MeetingStatus, sinceMs: latestMs };
  }
  return { status: (latestMs > nowMs ? "scheduled" : "not_logged") as MeetingStatus, sinceMs: null };
}

// A no-show/cancel that was followed by a later, non-canceled meeting = rebooked.
function meetingsShowRebook(meetings: Meeting[]): boolean {
  const sorted = [...meetings].sort(byTimeAsc);
  const firstMiss = sorted.findIndex((m) => m.hs_meeting_outcome === "NO_SHOW" || m.hs_meeting_outcome === "CANCELED");
  return firstMiss >= 0 && sorted.slice(firstMiss + 1).some((m) => m.hs_meeting_outcome !== "CANCELED");
}

function earliestValue(history: Array<{ value: string; timestamp: string }> | undefined): string | undefined {
  if (!history || history.length === 0) return undefined;
  return [...history]
    .filter((h) => h.value)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0]?.value;
}

export async function syncTeamDeals(sinceDay: string) {
  const { overflow, results: found } = await searchAll<DealProps>(
    "deals",
    [{ propertyName: "createdate", operator: "GTE", value: String(torontoMidnightUtcMs(sinceDay)) }],
    ["dealname"],
  );
  if (overflow) throw new Error(`team deal sync: more than 10k deals since ${sinceDay}`);
  const dealIds = found.map((d) => d.id);
  if (dealIds.length === 0) return { deals: 0 };

  const deals = await batchReadObjectsWithHistory<DealProps>(
    "deals",
    dealIds,
    [
      "dealname",
      "pipeline",
      "dealstage",
      "createdate",
      "hubspot_owner_id",
      "sql_accepted_date",
      "bant_qualified",
      "source_group",
      "source",
      "intro_meeting_status",
    ],
    ["hubspot_owner_id", "pipeline", "dealstage", "intro_meeting_status"],
  );

  // Only deals that STARTED in the Marketing Pipeline are BDR bookings.
  const booked = deals.filter((d) => {
    const original = earliestValue(d.propertiesWithHistory?.pipeline) ?? d.properties.pipeline;
    return original === MARKETING_PIPELINE_ID;
  });
  const bookedIds = booked.map((d) => d.id);

  const [dealToMeetings, dealToContacts, dealToCompanies] = await Promise.all([
    batchReadAssociations("deals", "meetings", bookedIds),
    batchReadAssociations("deals", "contacts", bookedIds),
    batchReadAssociations("deals", "companies", bookedIds),
  ]);
  const contactIds = [...new Set([...dealToContacts.values()].flat())];
  const companyIds = [...new Set([...dealToCompanies.values()].flat())];
  const [contactToMeetings, companyToMeetings] = await Promise.all([
    batchReadAssociations("contacts", "meetings", contactIds),
    batchReadAssociations("companies", "meetings", companyIds),
  ]);

  // Every meeting in the window too, for title matching: the intro meeting is
  // often attached to a different contact than the one on the deal (seen
  // live — "Association of Alberta Registry Agents - IWI Group - Sage
  // Introduction" exists but isn't reachable from its deal), while titles
  // follow a consistent "<Company> - IWI Group - ..." convention.
  const { overflow: meetingOverflow, results: windowMeetings } = await searchAll<MeetingProps & { hs_meeting_title?: string }>(
    "meetings",
    [{ propertyName: "hs_createdate", operator: "GTE", value: String(torontoMidnightUtcMs(sinceDay) - MEETING_LOOKBACK_MS) }],
    ["hs_timestamp", "hs_createdate", "hs_meeting_outcome", "hs_meeting_title"],
  );
  if (meetingOverflow) throw new Error(`team deal sync: more than 10k meetings since ${sinceDay}`);

  const meetingsById = new Map(windowMeetings.map((m) => [m.id, { id: m.id, ...m.properties }]));
  const missingIds = [
    ...new Set([
      ...[...dealToMeetings.values()].flat(),
      ...[...contactToMeetings.values()].flat(),
      ...[...companyToMeetings.values()].flat(),
    ]),
  ].filter((id) => !meetingsById.has(id));
  const extra = await batchReadObjects<MeetingProps & { hs_meeting_title?: string }>("meetings", missingIds, [
    "hs_timestamp",
    "hs_createdate",
    "hs_meeting_outcome",
    "hs_meeting_title",
  ]);
  for (const m of extra) meetingsById.set(m.id, { id: m.id, ...m.properties });
  // Calendar-synced cancellations arrive titled "Canceled: <original title>"
  // with no outcome set (seen live: "Canceled: Sage - IWI") — treat the
  // prefix as a CANCELED outcome, and strip it for title matching.
  const CANCELED_PREFIX = /^\s*cancell?ed\s*:\s*/i;
  for (const m of meetingsById.values()) {
    if (!m.hs_meeting_outcome && CANCELED_PREFIX.test(m.hs_meeting_title ?? "")) m.hs_meeting_outcome = "CANCELED";
  }
  const normalize = (s: string) =>
    s.replace(CANCELED_PREFIX, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const titledMeetings = windowMeetings.map((m) => ({ id: m.id, title: normalize(m.properties.hs_meeting_title ?? "") }));

  const nowMs = Date.now();
  const rows: (typeof teamDeals.$inferInsert)[] = booked.map((d) => {
    const p = d.properties;
    const createdMs = Date.parse(p.createdate ?? "");

    // "<Company> - New Deal" -> "company"; short names are skipped to avoid
    // false matches on generic words.
    const dealCompany = normalize((p.dealname ?? "").split(" - ")[0]);
    const titleMatches =
      dealCompany.length >= 5 ? titledMeetings.filter((m) => m.title.startsWith(dealCompany)).map((m) => m.id) : [];
    const candidateIds = new Set([
      ...(dealToMeetings.get(d.id) ?? []),
      ...(dealToContacts.get(d.id) ?? []).flatMap((c) => contactToMeetings.get(c) ?? []),
      ...(dealToCompanies.get(d.id) ?? []).flatMap((c) => companyToMeetings.get(c) ?? []),
      ...titleMatches,
    ]);
    const candidates = [...candidateIds]
      .map((id) => meetingsById.get(id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .filter((m) => Date.parse(m.hs_createdate ?? m.hs_timestamp ?? "") >= createdMs - MEETING_LOOKBACK_MS);
    const intro = [...candidates].sort(
      (a, b) => Date.parse(a.hs_timestamp ?? "") - Date.parse(b.hs_timestamp ?? ""),
    )[0];

    const history = d.propertiesWithHistory ?? {};
    const firstEntry = (prop: string, match: (v: string) => boolean) =>
      (history[prop] ?? [])
        .filter((h) => match(h.value))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0];

    // SQL: the explicit "SQL Accepted Date" when set, else the day the deal
    // first moved into the Sales Pipeline (that move IS the SQL hand-off here).
    const movedToSales = firstEntry("pipeline", (v) => v === SALES_PIPELINE_ID);
    const sqlDate =
      p.sql_accepted_date?.slice(0, 10) ?? (movedToSales ? toTorontoDateStr(Date.parse(movedToSales.timestamp)) : null);
    // MQL (per the user): reached Pre-Assessment (or later), OR a System /
    // General Overview meeting got scheduled — whichever happened first.
    // Overview meetings are recognised by title ("… Sage Intacct General
    // Overview", "System Overview - …"); canceled ones don't count.
    const enteredMql = firstEntry("dealstage", (v) => MQL_STAGES.has(v));
    const stageMqlMs = enteredMql
      ? Date.parse(enteredMql.timestamp)
      : MQL_STAGES.has(p.dealstage ?? "")
        ? createdMs
        : null;
    const overviewMs = candidates
      .filter((m) => OVERVIEW_TITLE.test(m.hs_meeting_title ?? "") && m.hs_meeting_outcome !== "CANCELED")
      .map((m) => Date.parse(m.hs_createdate ?? m.hs_timestamp ?? ""))
      .filter((ms) => !Number.isNaN(ms))
      .sort((a, b) => a - b)[0];
    const mqlMs = [stageMqlMs, overviewMs ?? null].filter((v): v is number => v != null).sort((a, b) => a - b)[0];
    const mqlDate = mqlMs != null ? toTorontoDateStr(mqlMs) : null;

    // Status: a final Intro Meeting Status set in HubSpot wins; otherwise
    // infer from the meeting records. "Scheduled" set by hand only overrides
    // an inferred needs_rebook (someone rebooked it), dated by the meetings.
    const derived = deriveMeetingStatus(candidates, Boolean(mqlDate || sqlDate), nowMs);
    const manual = p.intro_meeting_status ?? "";
    const statusHistory = [...(history.intro_meeting_status ?? [])].sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
    );
    let meetingStatus: MeetingStatus;
    let statusSinceMs: number | null;
    let statusSource: "hubspot" | "auto";
    if (MANUAL_FINAL_STATUSES.has(manual)) {
      meetingStatus = manual as MeetingStatus;
      const setAt = [...statusHistory].reverse().find((h) => h.value === manual);
      statusSinceMs = setAt ? Date.parse(setAt.timestamp) : null;
      statusSource = "hubspot";
    } else if (manual === "scheduled" && derived.status === "needs_rebook") {
      const next = candidates.find((m) => Date.parse(m.hs_timestamp ?? "") > nowMs);
      meetingStatus = next ? "scheduled" : "not_logged";
      statusSinceMs = null;
      statusSource = "hubspot";
    } else {
      meetingStatus = derived.status;
      statusSinceMs = derived.sinceMs;
      statusSource = "auto";
    }
    const rebookIdx = statusHistory.findIndex((h) => h.value === "needs_rebook");
    const rebooked =
      (rebookIdx >= 0 && statusHistory.slice(rebookIdx + 1).some((h) => h.value === "scheduled" || h.value === "held")) ||
      meetingsShowRebook(candidates);

    return {
      hubspotDealId: d.id,
      dealName: p.dealname ?? null,
      bookedByOwnerId: earliestValue(d.propertiesWithHistory?.hubspot_owner_id) ?? p.hubspot_owner_id ?? null,
      currentOwnerId: p.hubspot_owner_id ?? null,
      pipeline: p.pipeline ?? null,
      dealStage: p.dealstage ?? null,
      createdAt: new Date(createdMs),
      meetingId: intro?.id ?? null,
      meetingAt: intro?.hs_timestamp ? new Date(intro.hs_timestamp) : null,
      meetingStatus,
      statusSource,
      statusSince: statusSinceMs ? new Date(statusSinceMs) : null,
      rebooked,
      sourceGroup: effectiveSourceGroup(p),
      mqlDate,
      sqlDate,
      bant: p.bant_qualified === "true",
      closedWon: p.dealstage === "closedwon",
      lastSyncedAt: new Date(),
    };
  });

  for (const batch of chunkArray(rows, 200)) {
    await db
      .insert(teamDeals)
      .values(batch)
      .onConflictDoUpdate({
        target: teamDeals.hubspotDealId,
        set: {
          dealName: sql`excluded.deal_name`,
          bookedByOwnerId: sql`excluded.booked_by_owner_id`,
          currentOwnerId: sql`excluded.current_owner_id`,
          pipeline: sql`excluded.pipeline`,
          dealStage: sql`excluded.deal_stage`,
          createdAt: sql`excluded.created_at`,
          meetingId: sql`excluded.meeting_id`,
          meetingAt: sql`excluded.meeting_at`,
          meetingStatus: sql`excluded.meeting_status`,
          statusSource: sql`excluded.status_source`,
          statusSince: sql`excluded.status_since`,
          rebooked: sql`excluded.rebooked`,
          sourceGroup: sql`excluded.source_group`,
          mqlDate: sql`excluded.mql_date`,
          sqlDate: sql`excluded.sql_date`,
          bant: sql`excluded.bant`,
          closedWon: sql`excluded.closed_won`,
          lastSyncedAt: sql`excluded.last_synced_at`,
        },
      });
  }

  // Deals deleted in HubSpot (or no longer in the window) drop out — guarded
  // so an empty fetch can never wipe the table.
  if (bookedIds.length > 0) {
    await db
      .delete(teamDeals)
      .where(
        and(
          gte(teamDeals.createdAt, new Date(torontoMidnightUtcMs(sinceDay))),
          notInArray(teamDeals.hubspotDealId, bookedIds),
        ),
      );
  }

  return { deals: rows.length };
}

// Hourly entry point: re-pull the last few days of calls (dispositions get
// edited after the fact) and every booked deal since Jan 1 of last year
// (deals are few, and their stage/BANT/outcome change for weeks).
export async function runTeamSync() {
  const today = todayInToronto();
  const callResult = await syncTeamCalls(addDays(today, -2), today);
  const dealResult = await syncTeamDeals(`${Number(today.slice(0, 4)) - 1}-01-01`);
  return { ...callResult, ...dealResult };
}
