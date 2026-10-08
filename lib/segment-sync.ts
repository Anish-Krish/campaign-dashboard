import { db } from "@/lib/db";
import { segmentLeads, segments } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  batchReadAssociations,
  batchReadObjects,
  getCallDispositionOptions,
  getListMemberIds,
} from "@/lib/hubspot";
import { toTorontoDateStr, todayInToronto } from "@/lib/timezone";

const CONVERSATION_LABELS = new Set(["Connected - 01 - Pitch", "Connected - 02 - Past Pitch", "Connected - 03 - Meeting"]);

// A segment keeps syncing until a week after its end date (late dispositions,
// lead-status changes), then freezes so the hourly run stays fast.
const FREEZE_AFTER_DAYS = 7;

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

type CallProps = {
  hs_timestamp?: string;
  hubspot_owner_id?: string;
  hs_call_disposition?: string;
  hs_call_direction?: string;
};

// Rebuilds segment_leads for every active segment, then credits each BDR deal
// to a segment. Rules (per the user):
//  - Leads = every contact currently on the segment's HubSpot list.
//  - Calls only count if made BY the segment's rep, outbound, on a Toronto
//    day inside the segment's start..end window.
//  - A call is credited to ONE segment: when a contact sits in several of the
//    rep's segments with overlapping windows, the most recently registered
//    segment wins (segments are processed newest-first and claim calls).
// options.segmentIds limits the rebuild to specific segments (used right after
// a registration so the form returns quickly); the next hourly run redoes the
// full newest-wins call claiming across every active segment.
export async function runSegmentSync(options?: { all?: boolean; segmentIds?: number[] }) {
  const today = todayInToronto();
  const all = await db.select().from(segments).orderBy(sql`${segments.createdAt} desc`);
  const active = all.filter((s) =>
    options?.segmentIds
      ? options.segmentIds.includes(s.id)
      : options?.all || !s.lastSyncedAt || !s.endDate || addDays(s.endDate, FREEZE_AFTER_DAYS) >= today,
  );

  if (active.length > 0) {
    const dispositions = await getCallDispositionOptions();
    const labelById = new Map(dispositions.map((d) => [d.value, d.label]));

    const membersBySegment = new Map<number, string[]>();
    for (const s of active) membersBySegment.set(s.id, await getListMemberIds(s.hubspotListId));
    const contactIds = [...new Set([...membersBySegment.values()].flat())];

    const [contactRecords, contactToCompany, contactToCalls] = await Promise.all([
      batchReadObjects<{ hs_lead_status?: string }>("contacts", contactIds, ["hs_lead_status"]),
      batchReadAssociations("contacts", "companies", contactIds),
      batchReadAssociations("contacts", "calls", contactIds),
    ]);
    const leadStatus = new Map(contactRecords.map((c) => [c.id, c.properties.hs_lead_status ?? null]));

    const callIds = [...new Set([...contactToCalls.values()].flat())];
    const callRecords = await batchReadObjects<CallProps>("calls", callIds, [
      "hs_timestamp",
      "hubspot_owner_id",
      "hs_call_disposition",
      "hs_call_direction",
    ]);
    const callsById = new Map(callRecords.map((c) => [c.id, c.properties]));

    const claimed = new Set<string>();
    for (const s of active) {
      const end = s.endDate ?? today;
      const rows: (typeof segmentLeads.$inferInsert)[] = [];
      for (const contactId of membersBySegment.get(s.id) ?? []) {
        let calls = 0;
        let connected = false;
        let conversation = false;
        for (const callId of contactToCalls.get(contactId) ?? []) {
          const c = callsById.get(callId);
          if (!c || claimed.has(callId)) continue;
          if (c.hubspot_owner_id !== s.ownerId || c.hs_call_direction === "INBOUND") continue;
          const day = c.hs_timestamp ? toTorontoDateStr(Date.parse(c.hs_timestamp)) : null;
          if (!day || day < s.startDate || day > end) continue;
          claimed.add(callId);
          calls += 1;
          const label = c.hs_call_disposition ? (labelById.get(c.hs_call_disposition) ?? "") : "";
          if (label.startsWith("Connected")) connected = true;
          if (CONVERSATION_LABELS.has(label)) conversation = true;
        }
        rows.push({
          segmentId: s.id,
          contactId,
          companyId: contactToCompany.get(contactId)?.[0] ?? null,
          leadStatus: leadStatus.get(contactId) ?? null,
          calls,
          connected,
          conversation,
        });
      }
      await db.transaction(async (tx) => {
        await tx.delete(segmentLeads).where(eq(segmentLeads.segmentId, s.id));
        for (let i = 0; i < rows.length; i += 500) await tx.insert(segmentLeads).values(rows.slice(i, i + 500));
        await tx.update(segments).set({ lastSyncedAt: new Date() }).where(eq(segments.id, s.id));
      });
    }
  }

  // Credit each booked deal to the newest segment of the SAME rep that holds
  // one of the deal's contacts and whose window covers the booking day.
  // Everything else is "outside segments" (segment_id null).
  await db.execute(sql`
    update team_deals d set segment_id = (
      select s.id from segments s
      join segment_leads l on l.segment_id = s.id
      where l.contact_id = any(d.contact_ids)
        and s.owner_id = d.booked_by_owner_id
        and to_char(d.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD')::date
            between s.start_date and coalesce(s.end_date, ${today}::date)
      order by s.created_at desc
      limit 1
    )
  `);

  return { segments: active.length };
}
