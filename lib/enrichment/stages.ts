// Pure constants/types shared between the server-side Inngest function
// (lib/inngest/functions/enrichmentWaterfall.ts), the server actions that
// fire scoped stage events (app/(dashboard)/enrichment/actions.ts), and the
// client-side per-stage trigger bar (components/EnrichmentExplorer.tsx).
// Deliberately has zero imports — anything with a `db`/drizzle import here
// would get pulled into the client bundle the moment the table component
// imports it.

export const ALL_STAGES = [
  "hubspot_rematch",
  "leadmagic_email",
  "prospeo_email",
  "zerobounce",
  "leadmagic_mobile",
  "prospeo_mobile",
] as const;
export type Stage = (typeof ALL_STAGES)[number];

export const EMAIL_STAGES: readonly Stage[] = ["hubspot_rematch", "leadmagic_email", "prospeo_email", "zerobounce"];
export const MOBILE_STAGES: readonly Stage[] = ["leadmagic_mobile", "prospeo_mobile"];

export const STAGE_LABELS: Record<Stage, string> = {
  hubspot_rematch: "HubSpot Rematch",
  leadmagic_email: "LeadMagic (Email)",
  prospeo_email: "Prospeo (Email)",
  zerobounce: "ZeroBounce",
  leadmagic_mobile: "LeadMagic (Mobile)",
  prospeo_mobile: "Prospeo (Mobile)",
};
