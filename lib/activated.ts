import { db } from "@/lib/db";
import { activatedLeads, teamMembers } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { batchReadAssociations, batchReadObjects, batchReadObjectsWithHistory, searchAll } from "@/lib/hubspot";

// Activated lead (per the user): Lead Status "Open Deal" but no deal created
// yet — on the contact or on its company. These are follow-ups: the BDR got
// interest and still has to book the meeting.
//
// Credit goes to the team member who set the status (HubSpot user ids equal
// owner ids in this portal — verified on Hadi/Talha), else the contact owner;
// bulk edits by anyone else fall back to the owner. Contacts not tied to a
// team member are skipped.

type ContactProps = {
  firstname?: string;
  lastname?: string;
  jobtitle?: string;
  hubspot_owner_id?: string;
  associatedcompanyid?: string;
};

type HistoryEntry = { value: string; timestamp: string; updatedByUserId?: number | string };

export async function syncActivatedLeads() {
  const members = await db.select({ id: teamMembers.hubspotOwnerId }).from(teamMembers);
  const team = new Set(members.map((m) => m.id));

  const { overflow, results } = await searchAll<ContactProps>(
    "contacts",
    [{ propertyName: "hs_lead_status", operator: "EQ", value: "OPEN_DEAL" }],
    ["firstname", "lastname", "jobtitle", "hubspot_owner_id", "associatedcompanyid"],
  );
  if (overflow) throw new Error("activated leads: more than 10k Open Deal contacts");

  // Drop anything with a deal on the contact or its company.
  const contactIds = results.map((c) => c.id);
  const companyIds = [...new Set(results.map((c) => c.properties.associatedcompanyid).filter((x): x is string => Boolean(x)))];
  const [contactDeals, companyDeals] = await Promise.all([
    batchReadAssociations("contacts", "deals", contactIds),
    batchReadAssociations("companies", "deals", companyIds),
  ]);
  const noDeal = results.filter((c) => {
    if ((contactDeals.get(c.id) ?? []).length > 0) return false;
    const co = c.properties.associatedcompanyid;
    return !co || (companyDeals.get(co) ?? []).length === 0;
  });

  const [history, companies] = await Promise.all([
    batchReadObjectsWithHistory<ContactProps>("contacts", noDeal.map((c) => c.id), ["firstname"], ["hs_lead_status"]),
    batchReadObjects<{ name?: string }>(
      "companies",
      [...new Set(noDeal.map((c) => c.properties.associatedcompanyid).filter((x): x is string => Boolean(x)))],
      ["name"],
    ),
  ]);
  const setBy = new Map(
    history.map((h) => {
      const entries = (h.propertiesWithHistory?.hs_lead_status ?? []) as HistoryEntry[];
      const latest = entries
        .filter((e) => e.value === "OPEN_DEAL")
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
      return [h.id, latest] as const;
    }),
  );
  const companyName = new Map(companies.map((c) => [c.id, c.properties.name ?? null]));

  const rows: (typeof activatedLeads.$inferInsert)[] = [];
  for (const c of noDeal) {
    const p = c.properties;
    const entry = setBy.get(c.id);
    const by = entry?.updatedByUserId != null ? String(entry.updatedByUserId) : null;
    const ownerId = by && team.has(by) ? by : p.hubspot_owner_id && team.has(p.hubspot_owner_id) ? p.hubspot_owner_id : null;
    if (!ownerId || !entry) continue;
    rows.push({
      contactId: c.id,
      companyId: p.associatedcompanyid || null,
      ownerId,
      contactName: [p.firstname, p.lastname].filter(Boolean).join(" ").trim() || null,
      companyName: p.associatedcompanyid ? (companyName.get(p.associatedcompanyid) ?? null) : null,
      jobTitle: p.jobtitle || null,
      activatedAt: new Date(entry.timestamp),
      syncedAt: new Date(),
    });
  }

  // Full rebuild (a guarded swap: an empty pull never wipes the table).
  if (results.length === 0) return { activated: 0 };
  await db.transaction(async (tx) => {
    await tx.delete(activatedLeads);
    for (let i = 0; i < rows.length; i += 500) await tx.insert(activatedLeads).values(rows.slice(i, i + 500));
    // Segment credit: the most recent segment of the credited rep that has
    // this contact on its list.
    await tx.execute(sql`
      update activated_leads a set segment_id = (
        select s.id from segment_leads l join segments s on s.id = l.segment_id
        where l.contact_id = a.contact_id and s.owner_id = a.owner_id
        order by s.start_date desc limit 1)`);
  });
  return { activated: rows.length };
}
