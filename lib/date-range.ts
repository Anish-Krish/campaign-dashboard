import { todayInToronto } from "@/lib/timezone";

export type RangeKey = "this_week" | "last_week" | "last_30" | "last_90" | "custom";

const VALID_RANGES = new Set<RangeKey>(["this_week", "last_week", "last_30", "last_90", "custom"]);

// Pure calendar-day arithmetic on "YYYY-MM-DD" strings — anchored to UTC
// purely as a calculator (no real instant/timezone meaning here), then
// formatted back the same way, so this never reintroduces the kind of local-
// timezone drift the Toronto timestamp fixes were about.
function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function formatDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr: string, days: number): string {
  const d = parseDateStr(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateStr(d);
}
function mondayOf(dateStr: string): string {
  const d = parseDateStr(dateStr);
  const dow = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return formatDateStr(d);
}

export type ResolvedDateRange = {
  range: RangeKey;
  startDate: string;
  endDate: string;
  label: string;
};

// Resolves a rep page's ?range=...&from=...&to=... search params into a
// concrete Toronto-day-bounded [startDate, endDate]. "This/last week" is
// Monday–Sunday. Defaults to last_30 for a missing/invalid range, or for
// "custom" missing valid from/to.
export function resolveDateRange(params: {
  range?: string;
  from?: string;
  to?: string;
}): ResolvedDateRange {
  const today = todayInToronto();
  const range: RangeKey = VALID_RANGES.has(params.range as RangeKey) ? (params.range as RangeKey) : "last_30";

  if (range === "custom" && params.from && params.to) {
    const startDate = params.from <= params.to ? params.from : params.to;
    const endDate = params.from <= params.to ? params.to : params.from;
    return { range, startDate, endDate, label: `${startDate} – ${endDate}` };
  }

  if (range === "this_week") {
    return { range, startDate: mondayOf(today), endDate: today, label: "This week" };
  }

  if (range === "last_week") {
    const thisMonday = mondayOf(today);
    return {
      range,
      startDate: addDays(thisMonday, -7),
      endDate: addDays(thisMonday, -1),
      label: "Last week",
    };
  }

  if (range === "last_90") {
    return { range, startDate: addDays(today, -89), endDate: today, label: "Last 90 days" };
  }

  return { range: "last_30", startDate: addDays(today, -29), endDate: today, label: "Last 30 days" };
}
