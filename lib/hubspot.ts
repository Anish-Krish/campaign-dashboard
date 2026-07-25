const BASE_URL = "https://api.hubapi.com";

// Verified from this portal's own API responses (contact/company/call
// `url` fields all use this portal ID) — overridable via env var in case
// this ever points at a different HubSpot account.
const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || "43446506";

export function hubspotContactUrl(contactId: string): string {
  return `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-1/${contactId}`;
}

function authHeaders() {
  const token = process.env.HUBSPOT_API_KEY;
  if (!token) throw new Error("HUBSPOT_API_KEY is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function hubspotFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot API ${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// --- Lists (a.k.a. "segments") ---------------------------------------------
// Verified against a live portal: GET /crm/v3/lists/{listId}/memberships
// returns { results: [{ recordId, membershipTimestamp }], total } — no `paging`
// cursor was observed on a small list, so page defensively on both shapes.

interface ListMembershipsResponse {
  results: Array<{ recordId: string }>;
  paging?: { next?: { after: string } };
}

export async function getListMemberIds(listId: string): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const qs = new URLSearchParams({ limit: "250" });
    if (after) qs.set("after", after);
    const page = await hubspotFetch<ListMembershipsResponse>(
      `/crm/v3/lists/${listId}/memberships?${qs.toString()}`,
    );
    ids.push(...page.results.map((r) => r.recordId));
    after = page.paging?.next?.after;
  } while (after);
  return ids;
}

// --- Generic batch object read ---------------------------------------------

interface BatchReadResult<P> {
  results: Array<{ id: string; properties: P }>;
}

export async function batchReadObjects<P extends Record<string, unknown>>(
  objectType: string,
  ids: string[],
  properties: string[],
): Promise<Array<{ id: string; properties: P }>> {
  const chunks = chunk(ids, 100).filter((c) => c.length > 0);
  const pages = await Promise.all(
    chunks.map((c) =>
      hubspotFetch<BatchReadResult<P>>(`/crm/v3/objects/${objectType}/batch/read`, {
        method: "POST",
        body: JSON.stringify({ properties, inputs: c.map((id) => ({ id })) }),
      }),
    ),
  );
  return pages.flatMap((p) => p.results);
}

// --- Associations (v4) ------------------------------------------------------

interface AssociationsBatchResponse {
  results: Array<{
    from: { id: string };
    // toObjectId comes back as a JSON number in practice (verified against a
    // live portal), not a string — coerce it below.
    to: Array<{ toObjectId: string | number }>;
  }>;
}

export async function batchReadAssociations(
  fromObjectType: string,
  toObjectType: string,
  fromIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const chunks = chunk(fromIds, 100).filter((c) => c.length > 0);
  const pages = await Promise.all(
    chunks.map((c) =>
      hubspotFetch<AssociationsBatchResponse>(
        `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`,
        {
          method: "POST",
          body: JSON.stringify({ inputs: c.map((id) => ({ id })) }),
        },
      ),
    ),
  );
  for (const page of pages) {
    for (const r of page.results) {
      map.set(
        r.from.id,
        r.to.map((t) => String(t.toObjectId)),
      );
    }
  }
  return map;
}

// --- Owners ------------------------------------------------------------------

interface Owner {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export async function listOwners(): Promise<Owner[]> {
  const owners: Owner[] = [];
  let after: string | undefined;
  do {
    // archived=true includes deactivated (but not fully-deleted) HubSpot
    // users, so contacts owned by a former rep still resolve to a name
    // instead of a dangling ID.
    const qs = new URLSearchParams({ limit: "100", archived: "true" });
    if (after) qs.set("after", after);
    const page = await hubspotFetch<{
      results: Owner[];
      paging?: { next?: { after: string } };
    }>(`/crm/v3/owners?${qs.toString()}`);
    owners.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);
  return owners;
}

// --- Call disposition options -------------------------------------------------
// Disposition values are portal-specific GUIDs, and the `hs_call_disposition`
// CRM property itself reports `externalOptions: true` with an empty `options`
// array — the real values live in the legacy Calling API, verified against a
// live portal: GET /calling/v1/dispositions -> [{ id, label, deleted }].

export async function getCallDispositionOptions(): Promise<
  Array<{ label: string; value: string }>
> {
  const options = await hubspotFetch<Array<{ id: string; label: string; deleted: boolean }>>(
    `/calling/v1/dispositions`,
  );
  return options.filter((o) => !o.deleted).map((o) => ({ label: o.label, value: o.id }));
}
