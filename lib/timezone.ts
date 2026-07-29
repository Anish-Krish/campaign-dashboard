// The team is in Toronto — everywhere the app buckets or compares by
// calendar day (campaign windows, the daily calls chart, the rep date-range
// filter) should mean a Toronto day, not a raw UTC one. A naive
// `date_trunc`/`Date.parse` split on server-stored UTC-equivalent timestamps
// shifts evening activity onto the wrong day (an 8pm Toronto call is already
// past midnight UTC). `Intl.DateTimeFormat` with the `America/Toronto` zone
// handles the EST/EDT switch automatically — no manual offset math needed.
export const TORONTO_TZ = "America/Toronto";

const TORONTO_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: TORONTO_TZ });

// Returns "YYYY-MM-DD" for the Toronto calendar day a given instant falls on.
export function toTorontoDateStr(ms: number): string {
  return TORONTO_DATE_FORMAT.format(new Date(ms));
}

export function todayInToronto(): string {
  return toTorontoDateStr(Date.now());
}
