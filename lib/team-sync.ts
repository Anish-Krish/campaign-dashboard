import { db } from "@/lib/db";
import { appSettings, teamCallDaily, teamDeals, teamIntroMeetings } from "@/lib/db/schema";
import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import {
  batchReadAssociations,
  batchReadObjects,
  batchReadObjectsWithHistory,
  getCallDispositionOptions,
  searchAll,
  type SearchFilter,
} from "@/lib/hubspot";
import { toTorontoDateStr, todayInToronto } from "@/lib/timezone";
import { syncActivatedLeads } from "@/lib/activated";

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

// Marketing Pipeline "Closed lost": a missed intro on a closed-lost deal is a
// lost meeting, not one waiting on a rebook.
const MARKETING_CLOSED_LOST = "123017108";

// HubSpot's notetaker records most intro meetings (transcript + AI summary).
// A recording with real length is proof the meeting happened — the held /
// no-show check. Shorter than this = the bot sat in an empty room.
const MIN_RECORDED_MS = 5 * 60 * 1000;

// How far before a deal's creation a contact's meeting can have been created
// and still count as that deal's intro meeting — BDRs book the meeting first
// and create the deal minutes-to-days later (e.g. Globe Printers: meeting
// 19:09, deal 19:12, and the meeting was never associated to the deal).
const MEETING_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
// Latest an intro attempt (incl. rebooks) can be after the booking.
const INTRO_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

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
  bant_qualified?: string;
  source_group?: string;
  source?: string;
};

type MeetingProps = {
  hs_timestamp?: string;
  hs_createdate?: string;
  hs_meeting_outcome?: string;
  hs_meeting_title?: string;
  hs_has_meeting_transcript?: string;
  hs_meeting_recording_duration?: string;
  hs_meeting_summary?: string;
};
const MEETING_PROPS = [
  "hs_timestamp",
  "hs_createdate",
  "hs_meeting_outcome",
  "hs_meeting_title",
  "hs_has_meeting_transcript",
  "hs_meeting_recording_duration",
  "hs_meeting_summary",
];

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
// HubSpot's notetaker was in use from Sep 2026 — before that, "Completed but
// not recorded" is normal and not worth flagging.
const RECORDING_ERA_MS = Date.parse("2026-09-01T04:00:00Z");
const byTimeAsc = (a: Meeting, b: Meeting) => Date.parse(a.hs_timestamp ?? "") - Date.parse(b.hs_timestamp ?? "");

function isRecorded(m: Meeting): boolean {
  const ms = Number(m.hs_meeting_recording_duration ?? 0);
  return ms >= MIN_RECORDED_MS || (m.hs_has_meeting_transcript === "true" && !(ms > 0 && ms < MIN_RECORDED_MS));
}
// One intro-meeting attempt's result. "Sat" = recorded by the notetaker or
// outcome Completed. A meeting marked No show / Canceled that a BDR later
// switched to Rescheduled (their "rebooked" signal, per the user) keeps its
// original miss — read from the outcome's history — so show rate can't be
// improved by editing the outcome; it's just flagged as rebooked. A meeting
// only ever marked Rescheduled was moved before it happened and doesn't count
// for or against show rate.
export type AttemptResult = "sat" | "no_show" | "canceled" | "rescheduled" | "scheduled" | "not_logged";

function attemptResult(m: Meeting, priorOutcomes: string[], nowMs: number): { result: AttemptResult; rebooked: boolean } {
  const outcome = m.hs_meeting_outcome ?? "";
  if (isRecorded(m) || outcome === "COMPLETED") return { result: "sat", rebooked: false };
  if (outcome === "NO_SHOW") return { result: "no_show", rebooked: false };
  if (outcome === "CANCELED") return { result: "canceled", rebooked: false };
  if (outcome === "RESCHEDULED") {
    if (priorOutcomes.includes("NO_SHOW")) return { result: "no_show", rebooked: true };
    if (priorOutcomes.includes("CANCELED")) return { result: "canceled", rebooked: true };
    return { result: "rescheduled", rebooked: true };
  }
  return { result: Date.parse(m.hs_timestamp ?? "") > nowMs ? "scheduled" : "not_logged", rebooked: false };
}

// Deal status, from the HubSpot meeting records only (per the user — the
// Intro Meeting Status deal field is no longer used) plus deal/company state:
//  - The intro attempts are the deal's meetings in time order up to and
//    including the first one that sat (later meetings are assessments etc.).
//  - HELD if an attempt sat; statusSource says how (recorded > outcome).
//    Failing that, a deal that moved on to MQL/SQL is held ("stage" — AEs
//    often leave the outcome at Scheduled), and its last past attempt is
//    counted as the one that sat.
//  - Otherwise the LATEST attempt decides: a no-show / cancel is LOST when
//    the deal is closed lost or its company or contact is Not Interested, else
//    NEEDS REBOOK — until a BDR rebooks it (outcome -> Rescheduled, or a new
//    meeting). Future -> scheduled; past with no outcome -> not_logged.
// The check: Completed with no recording, or a recorded meeting marked
// No show / Canceled, gets a checkFlag so someone verifies it.
function deriveIntro(
  meetings: Meeting[],
  outcomeHistory: Map<string, string[]>,
  progressed: boolean,
  lost: boolean,
  nowMs: number,
) {
  const sorted = [...meetings].sort(byTimeAsc);
  const attempts: { meeting: Meeting; result: AttemptResult; rebooked: boolean }[] = [];
  for (const m of sorted) {
    const a = attemptResult(m, outcomeHistory.get(m.id) ?? [], nowMs);
    attempts.push({ meeting: m, ...a });
    if (a.result === "sat") break;
  }
  // a miss followed by any later attempt was rebooked
  for (let i = 0; i < attempts.length - 1; i++) {
    if (attempts[i].result === "no_show" || attempts[i].result === "canceled") attempts[i].rebooked = true;
  }

  const recorded = meetings.filter(isRecorded).sort(byTimeAsc);
  const completed = meetings.filter((m) => m.hs_meeting_outcome === "COMPLETED");
  const proof = recorded[recorded.length - 1];
  const checkFlag = recorded.some((m) => ["NO_SHOW", "CANCELED", "RESCHEDULED"].includes(m.hs_meeting_outcome ?? ""))
    ? "no_show_but_recorded"
    : completed.length > 0 && recorded.length === 0 && completed.some((m) => Date.parse(m.hs_timestamp ?? "") >= RECORDING_ERA_MS)
      ? "completed_not_recorded"
      : null;
  const base = {
    attempts,
    checkFlag,
    summary: proof?.hs_meeting_summary ?? null,
    recordingMinutes: proof ? Math.round(Number(proof.hs_meeting_recording_duration ?? 0) / 60000) || null : null,
    rebooked: attempts.some((a) => a.rebooked),
    sinceMs: null as number | null,
  };

  const sat = attempts.find((a) => a.result === "sat");
  if (sat) return { ...base, status: "held" as MeetingStatus, source: isRecorded(sat.meeting) ? "recorded" : "outcome" };
  if (progressed) {
    const lastPast = [...attempts].reverse().find((a) => a.result === "not_logged" || a.result === "scheduled");
    if (lastPast && Date.parse(lastPast.meeting.hs_timestamp ?? "") <= nowMs) lastPast.result = "sat";
    return { ...base, status: "held" as MeetingStatus, source: "stage" };
  }
  if (attempts.length === 0) return { ...base, status: "no_meeting" as MeetingStatus, source: "auto" };
  const latest = attempts[attempts.length - 1];
  if ((latest.result === "no_show" || latest.result === "canceled") && !latest.rebooked) {
    const status: MeetingStatus = lost ? (latest.result === "no_show" ? "no_show_lost" : "cancelled_lost") : "needs_rebook";
    return { ...base, status, source: "auto", sinceMs: Date.parse(latest.meeting.hs_timestamp ?? "") };
  }
  if (latest.result === "not_logged") return { ...base, status: "not_logged" as MeetingStatus, source: "auto" };
  // scheduled, or rebooked / moved and waiting on the new meeting
  return { ...base, status: "scheduled" as MeetingStatus, source: "auto" };
}

function earliestValue(history: Array<{ value: string; timestamp: string }> | undefined): string | undefined {
  if (!history || history.length === 0) return undefined;
  return [...history]
    .filter((h) => h.value)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0]?.value;
}

export async function syncTeamDeals(sinceDay: string) {
  // Deals created in the window, plus OLDER deals touched in the window that
  // are now at MQL/SQL — MQL/SQL count in the month the stage was entered, so
  // a 2024 booking that became an SQL this month must still be picked up.
  const sinceMs = String(torontoMidnightUtcMs(sinceDay));
  const searches = await Promise.all([
    searchAll<DealProps>("deals", [{ propertyName: "createdate", operator: "GTE", value: sinceMs }], ["dealname"]),
    searchAll<DealProps>(
      "deals",
      [
        { propertyName: "createdate", operator: "LT", value: sinceMs },
        { propertyName: "hs_lastmodifieddate", operator: "GTE", value: sinceMs },
        { propertyName: "dealstage", operator: "IN", values: [...MQL_STAGES] },
      ],
      ["dealname"],
    ),
  ]);
  if (searches.some((r) => r.overflow)) throw new Error(`team deal sync: more than 10k deals since ${sinceDay}`);
  const dealIds = [...new Set(searches.flatMap((r) => r.results.map((d) => d.id)))];
  if (dealIds.length === 0) return { deals: 0 };
  return processTeamDeals(dealIds, { sinceDay, prune: true });
}

// Re-syncs just these deals (the live webhook / 1-minute check). Meetings are
// searched back far enough to cover a booking's intro window.
export async function syncTeamDealsByIds(dealIds: string[]) {
  if (dealIds.length === 0) return { deals: 0 };
  const sinceDay = addDays(todayInToronto(), -Math.ceil(INTRO_WINDOW_MS / 86400000) - 14);
  return processTeamDeals([...new Set(dealIds)], { sinceDay, prune: false });
}

// Reads the given deals from HubSpot and upserts team_deals + their intro
// attempts. prune: also drop deals created since sinceDay that are no longer
// BDR bookings / were deleted (full sync only).
async function processTeamDeals(dealIds: string[], { sinceDay, prune }: { sinceDay: string; prune: boolean }) {

  const deals = await batchReadObjectsWithHistory<DealProps>(
    "deals",
    dealIds,
    [
      "dealname",
      "pipeline",
      "dealstage",
      "createdate",
      "hubspot_owner_id",
      "bant_qualified",
      "source_group",
      "source",
    ],
    ["hubspot_owner_id", "pipeline", "dealstage", "bant_qualified"],
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
  const { overflow: meetingOverflow, results: windowMeetings } = await searchAll<MeetingProps>(
    "meetings",
    [{ propertyName: "hs_createdate", operator: "GTE", value: String(torontoMidnightUtcMs(sinceDay) - MEETING_LOOKBACK_MS) }],
    MEETING_PROPS,
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
  const extra = await batchReadObjects<MeetingProps>("meetings", missingIds, MEETING_PROPS);
  for (const m of extra) meetingsById.set(m.id, { id: m.id, ...m.properties });
  // Calendar-synced cancellations arrive titled "Canceled: <original title>"
  // with no outcome set (seen live: "Canceled: Sage - IWI") — treat the
  // prefix as a CANCELED outcome, and strip it for title matching.
  const CANCELED_PREFIX = /^\s*cancell?ed\s*:\s*/i;
  for (const m of meetingsById.values()) {
    if (!m.hs_meeting_outcome && CANCELED_PREFIX.test(m.hs_meeting_title ?? "")) m.hs_meeting_outcome = "CANCELED";
  }
  // Outcome history only matters for meetings now marked Rescheduled (was it
  // a no-show first?) — fetched just for those.
  const rescheduledIds = [...meetingsById.values()].filter((m) => m.hs_meeting_outcome === "RESCHEDULED").map((m) => m.id);
  const rescheduledHistory = await batchReadObjectsWithHistory<MeetingProps>(
    "meetings",
    rescheduledIds,
    ["hs_meeting_outcome"],
    ["hs_meeting_outcome"],
  );
  const outcomeHistory = new Map(
    rescheduledHistory.map((m) => [m.id, (m.propertiesWithHistory?.hs_meeting_outcome ?? []).map((h) => h.value)]),
  );

  // Companies marked Not Interested (Lead Status or Stage) make a missed
  // intro "lost" rather than "needs rebook" (per the user).
  const companyRecords = await batchReadObjects<{ hs_lead_status?: string; stage?: string }>("companies", companyIds, [
    "hs_lead_status",
    "stage",
  ]);
  // ...and so does a deal contact whose own Lead Status is Not Interested.
  const contactRecords = await batchReadObjects<{ hs_lead_status?: string }>("contacts", contactIds, ["hs_lead_status"]);
  const notInterestedContacts = new Set(
    contactRecords.filter((c) => /not[_ ]interested/i.test(c.properties.hs_lead_status ?? "")).map((c) => c.id),
  );
  const notInterestedCompanies = new Set(
    companyRecords
      .filter((c) => /not[_ ]interested/i.test(c.properties.hs_lead_status ?? "") || /not interested/i.test(c.properties.stage ?? ""))
      .map((c) => c.id),
  );

  const normalize = (s: string) =>
    s.replace(CANCELED_PREFIX, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const titledMeetings = windowMeetings.map((m) => ({ id: m.id, title: normalize(m.properties.hs_meeting_title ?? "") }));

  // BANT ticked after the fact (e.g. from a signed commission form) counts on
  // the day set here instead of the day the box was ticked — keyed by deal id.
  const [overrideRow] = await db.select().from(appSettings).where(eq(appSettings.key, "bant_date_overrides"));
  const bantOverrides = (overrideRow?.value ?? {}) as Record<string, string>;

  const nowMs = Date.now();
  const attemptRows: (typeof teamIntroMeetings.$inferInsert)[] = [];
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
    // Intro attempts must happen within INTRO_WINDOW_MS of the booking — a
    // first meeting months later is an assessment/proposal (seen live: a Feb
    // booking's "Sage 300 Proposal" in Sep), not the intro.
    const introCandidates = candidates.filter((m) => Date.parse(m.hs_timestamp ?? "") <= createdMs + INTRO_WINDOW_MS);
    const intro = [...introCandidates].sort(
      (a, b) => Date.parse(a.hs_timestamp ?? "") - Date.parse(b.hs_timestamp ?? ""),
    )[0];

    const history = d.propertiesWithHistory ?? {};
    const firstEntry = (prop: string, match: (v: string) => boolean) =>
      (history[prop] ?? [])
        .filter((h) => match(h.value))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0];

    // Stage-based, per the user — counted in the month the deal ENTERED the
    // stage, however old the deal is:
    //  - SQL = first moved into the Sales Pipeline.
    //  - MQL = first entered Pre-Assessment / System Overview; a deal that
    //    skipped straight to the Sales Pipeline became an MQL on that same day.
    const movedToSales = firstEntry("pipeline", (v) => v === SALES_PIPELINE_ID);
    const sqlMs = movedToSales
      ? Date.parse(movedToSales.timestamp)
      : p.pipeline === SALES_PIPELINE_ID
        ? createdMs
        : null;
    const enteredMql = firstEntry("dealstage", (v) => MQL_STAGES.has(v));
    const mqlMs = enteredMql ? Date.parse(enteredMql.timestamp) : MQL_STAGES.has(p.dealstage ?? "") ? createdMs : sqlMs;
    const sqlDate = sqlMs != null ? toTorontoDateStr(sqlMs) : null;
    const mqlDate = mqlMs != null ? toTorontoDateStr(mqlMs) : null;

    const lost =
      p.dealstage === MARKETING_CLOSED_LOST ||
      p.dealstage === "closedlost" ||
      (dealToCompanies.get(d.id) ?? []).some((c) => notInterestedCompanies.has(c)) ||
      (dealToContacts.get(d.id) ?? []).some((c) => notInterestedContacts.has(c));
    const derived = deriveIntro(introCandidates, outcomeHistory, Boolean(mqlDate || sqlDate), lost, nowMs);
    const meetingStatus = derived.status;
    const statusSinceMs = derived.sinceMs;
    const rebooked = derived.rebooked;
    for (const a of derived.attempts) {
      if (!a.meeting.hs_timestamp) continue;
      attemptRows.push({
        dealId: d.id,
        meetingId: a.meeting.id,
        meetingAt: new Date(a.meeting.hs_timestamp),
        result: a.result,
        rebooked: a.rebooked,
      });
    }

    // BANT counts in the month the box was ticked (never before the booking).
    const bantSet = p.bant_qualified === "true"
      ? [...(history.bant_qualified ?? [])]
          .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
          .find((h) => h.value === "true")
      : undefined;
    const bantMs = p.bant_qualified === "true" ? Math.max(createdMs, bantSet ? Date.parse(bantSet.timestamp) : createdMs) : null;

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
      statusSource: derived.source,
      checkFlag: derived.checkFlag,
      meetingSummary: derived.summary,
      recordingMinutes: derived.recordingMinutes,
      statusSince: statusSinceMs ? new Date(statusSinceMs) : null,
      rebooked,
      sourceGroup: effectiveSourceGroup(p),
      contactIds: dealToContacts.get(d.id) ?? [],
      companyIds: [...new Set(dealToCompanies.get(d.id) ?? [])],
      mqlDate,
      sqlDate,
      bant: p.bant_qualified === "true",
      bantDate: bantMs != null ? (bantOverrides[d.id] ?? toTorontoDateStr(bantMs)) : null,
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
          checkFlag: sql`excluded.check_flag`,
          meetingSummary: sql`excluded.meeting_summary`,
          recordingMinutes: sql`excluded.recording_minutes`,
          statusSince: sql`excluded.status_since`,
          rebooked: sql`excluded.rebooked`,
          sourceGroup: sql`excluded.source_group`,
          contactIds: sql`excluded.contact_ids`,
          companyIds: sql`excluded.company_ids`,
          mqlDate: sql`excluded.mql_date`,
          sqlDate: sql`excluded.sql_date`,
          bant: sql`excluded.bant`,
          bantDate: sql`excluded.bant_date`,
          closedWon: sql`excluded.closed_won`,
          lastSyncedAt: sql`excluded.last_synced_at`,
        },
      });
  }

  // Deals deleted in HubSpot (or no longer in the window) drop out — guarded
  // so an empty fetch can never wipe the table.
  if (prune && bookedIds.length > 0) {
    await db
      .delete(teamDeals)
      .where(
        and(
          gte(teamDeals.createdAt, new Date(torontoMidnightUtcMs(sinceDay))),
          notInArray(teamDeals.hubspotDealId, bookedIds),
        ),
      );
  }

  // Intro attempts are rebuilt for every synced deal (deal ids in this run).
  await db.transaction(async (tx) => {
    for (const ids of chunkArray(bookedIds, 500)) {
      await tx.delete(teamIntroMeetings).where(inArray(teamIntroMeetings.dealId, ids));
    }
    for (const batch of chunkArray(attemptRows, 500)) await tx.insert(teamIntroMeetings).values(batch);
    await tx.execute(sql`delete from team_intro_meetings where deal_id not in (select hubspot_deal_id from team_deals)`);
  });

  return { deals: rows.length };
}

// Hourly entry point: re-pull the last few days of calls (dispositions get
// edited after the fact) and every booked deal since Jan 1 of last year
// (deals are few, and their stage/BANT/outcome change for weeks).
export async function runTeamSync() {
  const today = todayInToronto();
  const callResult = await syncTeamCalls(addDays(today, -2), today);
  const dealResult = await syncTeamDeals(`${Number(today.slice(0, 4)) - 1}-01-01`);
  const activatedResult = await syncActivatedLeads();
  return { ...callResult, ...dealResult, ...activatedResult };
}
