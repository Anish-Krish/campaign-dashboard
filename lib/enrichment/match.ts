import { normalizeName, normalizeCompany, extractDomain, normalizeDomain } from "./normalize";

// Input shape for the "HubSpot rematch" stage: an existing HubSpot contact
// we already hold, used as a lookup source before spending LeadMagic/Prospeo
// credits. Field names are camelCase (unlike the CLI pipeline's raw CSV
// column keys) since this reads from `contacts`/`companies`, not a CSV.
export interface HubspotIndexInput {
  recordId: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
}

interface IndexedRecord {
  recordId: string;
  rawFirst: string | null;
  rawLast: string | null;
  email: string;
  phone: string;
}

export interface HubspotIndex {
  byNameCompany: Map<string, IndexedRecord[]>;
  byNameDomain: Map<string, IndexedRecord[]>;
  byLastDomain: Map<string, IndexedRecord[]>;
  byFirstDomain: Map<string, IndexedRecord[]>;
  byDomain: Map<string, IndexedRecord[]>;
}

function addToIndex(map: Map<string, IndexedRecord[]>, key: string | null, record: IndexedRecord) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(record);
}

export function buildHubspotIndex(rows: HubspotIndexInput[]): HubspotIndex {
  const byNameCompany = new Map<string, IndexedRecord[]>();
  const byNameDomain = new Map<string, IndexedRecord[]>();
  const byLastDomain = new Map<string, IndexedRecord[]>();
  const byFirstDomain = new Map<string, IndexedRecord[]>();
  const byDomain = new Map<string, IndexedRecord[]>();

  for (const row of rows) {
    const first = normalizeName(row.firstName);
    const last = normalizeName(row.lastName);
    const company = normalizeCompany(row.companyName);
    const email = (row.email || "").trim();
    const domain = normalizeDomain(extractDomain(email));
    const phone = (row.phone || "").trim();

    const record: IndexedRecord = {
      recordId: row.recordId,
      rawFirst: row.firstName,
      rawLast: row.lastName,
      email,
      phone,
    };

    if (first && last && company) addToIndex(byNameCompany, `${first}|${last}|${company}`, record);
    if (first && last && domain) addToIndex(byNameDomain, `${first}|${last}|${domain}`, record);
    if (last && domain) addToIndex(byLastDomain, `${last}|${domain}`, record);
    if (first && domain) addToIndex(byFirstDomain, `${first}|${domain}`, record);
    if (domain && email) addToIndex(byDomain, domain, record);
  }

  return { byNameCompany, byNameDomain, byLastDomain, byFirstDomain, byDomain };
}

type PatternTemplate = [string, (f: string, l: string) => string | null];

const PATTERN_TEMPLATES: PatternTemplate[] = [
  ["first.last", (f, l) => `${f}.${l}`],
  ["first_last", (f, l) => `${f}_${l}`],
  ["firstlast", (f, l) => `${f}${l}`],
  ["flast", (f, l) => (f && l ? `${f[0]}${l}` : null)],
  ["firstl", (f, l) => (f && l ? `${f}${l[0]}` : null)],
  ["lastf", (f, l) => (f && l ? `${l}${f[0]}` : null)],
  ["f.last", (f, l) => (f && l ? `${f[0]}.${l}` : null)],
  ["last.first", (f, l) => `${l}.${f}`],
  ["first", (f) => f || null],
  ["last", (_f, l) => l || null],
];

function classifyPattern(email: string, rawFirst: string | null, rawLast: string | null): string | null {
  const local = (email.split("@")[0] || "").toLowerCase();
  const f = normalizeName(rawFirst).replace(/\s+/g, "");
  const l = normalizeName(rawLast).replace(/\s+/g, "");
  if (!f && !l) return null;

  for (const [name, template] of PATTERN_TEMPLATES) {
    const candidate = template(f, l);
    if (candidate && candidate === local) return name;
  }
  return null;
}

function inferDominantPattern(domainContacts: IndexedRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const contact of domainContacts) {
    const pattern = classifyPattern(contact.email, contact.rawFirst, contact.rawLast);
    if (pattern) counts.set(pattern, (counts.get(pattern) || 0) + 1);
  }
  if (counts.size === 0) return null;

  let best: string | null = null;
  let bestCount = 0;
  for (const [name] of PATTERN_TEMPLATES) {
    const count = counts.get(name) || 0;
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

function applyPattern(patternName: string, first: string | null, last: string | null, domain: string): string | null {
  const f = normalizeName(first).replace(/\s+/g, "");
  const l = normalizeName(last).replace(/\s+/g, "");
  const template = PATTERN_TEMPLATES.find(([name]) => name === patternName);
  if (!template) return null;
  const local = template[1](f, l);
  if (!local) return null;
  return `${local}@${domain}`;
}

function resolveCandidates(
  candidates: IndexedRecord[],
): { status: "none" } | { status: "ambiguous" } | { status: "match"; record: IndexedRecord } {
  const distinctEmails = new Set(candidates.filter((c) => c.email).map((c) => c.email));
  if (distinctEmails.size === 0) return { status: "none" };
  if (distinctEmails.size > 1) return { status: "ambiguous" };
  return { status: "match", record: candidates.find((c) => c.email)! };
}

export interface Prospect {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  companyDomain: string | null;
}

export interface MatchResult {
  method: string;
  email: string | null;
  phone: string | null;
  recordId: string | null;
  source: string | null;
}

export function matchProspect(prospect: Prospect, index: HubspotIndex): MatchResult {
  const first = normalizeName(prospect.firstName);
  const last = normalizeName(prospect.lastName);
  const company = normalizeCompany(prospect.companyName);
  const domain = normalizeDomain(prospect.companyDomain);

  const passes: [string, string | null, Map<string, IndexedRecord[]>][] = [
    ["EXACT_NAME_COMPANY", company && first && last ? `${first}|${last}|${company}` : null, index.byNameCompany],
    ["NAME_DOMAIN", domain && first && last ? `${first}|${last}|${domain}` : null, index.byNameDomain],
    ["LAST_DOMAIN", domain && last ? `${last}|${domain}` : null, index.byLastDomain],
    ["FIRST_DOMAIN", domain && first ? `${first}|${domain}` : null, index.byFirstDomain],
  ];

  for (const [name, key, map] of passes) {
    if (!key) continue;
    const candidates = map.get(key);
    if (!candidates) continue;

    const resolved = resolveCandidates(candidates);
    if (resolved.status === "none") continue;
    if (resolved.status === "ambiguous") {
      return { method: `AMBIGUOUS (${name})`, email: null, phone: null, recordId: null, source: null };
    }
    return {
      method: name,
      email: resolved.record.email,
      phone: resolved.record.phone || null,
      recordId: resolved.record.recordId,
      source: "HubSpot Match",
    };
  }

  if (domain) {
    const domainContacts = index.byDomain.get(domain) || [];
    if (domainContacts.length > 0) {
      const pattern = inferDominantPattern(domainContacts);
      if (pattern) {
        const estimatedEmail = applyPattern(pattern, prospect.firstName, prospect.lastName, domain);
        if (estimatedEmail) {
          return {
            method: "PATTERN_ESTIMATE",
            email: estimatedEmail,
            phone: null,
            recordId: null,
            source: "Estimated Pattern",
          };
        }
      }
    }
  }

  return { method: "", email: null, phone: null, recordId: null, source: "" };
}
