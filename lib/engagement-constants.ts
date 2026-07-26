// Kept separate from lib/queries.ts (which imports the DB client at module
// load) so client components can import these plain constants without
// accidentally bundling server-only code (postgres.js isn't browser-safe).

export type EngagementStatus =
  | "unengaged"
  | "not_interested"
  | "unqualified"
  | "activated_lead"
  | "meeting_booked";

export const ENGAGEMENT_STATUSES: EngagementStatus[] = [
  "unengaged",
  "not_interested",
  "unqualified",
  "activated_lead",
  "meeting_booked",
];

export const ENGAGEMENT_LABELS: Record<EngagementStatus, string> = {
  unengaged: "Unengaged",
  not_interested: "Not Interested",
  unqualified: "Unqualified",
  activated_lead: "Activated Lead",
  meeting_booked: "Meeting Booked",
};
