import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";

export const engagementStatusEnum = pgEnum("engagement_status", [
  "unengaged",
  "not_interested",
  "unqualified",
  "activated_lead",
  "meeting_booked",
]);

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  hubspotListId: text("hubspot_list_id").notNull(),
  sequenceLabel: text("sequence_label"),
  ownerName: text("owner_name"),
  ownerEmail: text("owner_email"),
  targetCount: integer("target_count"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const owners = pgTable("owners", {
  hubspotOwnerId: text("hubspot_owner_id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
});

export const companies = pgTable("companies", {
  hubspotCompanyId: text("hubspot_company_id").primaryKey(),
  name: text("name").notNull(),
  industry: text("industry"),
});

// `companyId` / `ownerId` below are intentionally NOT foreign keys to
// `companies`/`owners`. HubSpot owner and company IDs can reference deleted
// or archived records that never show up in our synced `owners`/`companies`
// tables (e.g. a fully deleted HubSpot user, not just deactivated) — a hard
// FK there means one such dangling reference aborts the entire insert (and,
// pre-fix, the whole campaign's sync). Joins against these are done as
// LEFT JOINs in lib/queries.ts and degrade to "Unassigned"/"Unknown" instead.
export const campaignCompanies = pgTable(
  "campaign_companies",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    engagementStatus: engagementStatusEnum("engagement_status")
      .notNull()
      .default("unengaged"),
    statusSourceContactId: text("status_source_contact_id"),
    statusUpdatedAt: timestamp("status_updated_at"),
  },
  (t) => [unique().on(t.campaignId, t.companyId)],
);

export const contacts = pgTable("contacts", {
  hubspotContactId: text("hubspot_contact_id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  companyId: text("company_id"),
  ownerId: text("owner_id"), // the CRM-assigned contact owner — NOT necessarily who worked this contact for this campaign
  firstName: text("first_name"),
  lastName: text("last_name"),
  jobTitle: text("job_title"),
  leadStatus: text("lead_status"), // raw hs_lead_status value (NEW / IN_PROGRESS / OPEN_DEAL / "Not Interested" / "Unqualified")
  isAuthority: boolean("is_authority").notNull().default(false),
  hasCallLogged: boolean("has_call_logged").notNull().default(false),
  callCount: integer("call_count").notNull().default(0), // total call attempts within the campaign window
  lastCallConnected: boolean("last_call_connected").notNull().default(false),
  // Owner of the call/meeting activity itself (who actually made the call /
  // booked the meeting), distinct from `ownerId` — a call's "Activity
  // assigned to" can be a completely different person than who owns the
  // contact in the CRM.
  callOwnerId: text("call_owner_id"), // owner of the most recent call overall (drives "Calls Made" attribution)
  connectedCallOwnerId: text("connected_call_owner_id"), // owner of the most recent CONNECTED call specifically (drives "Connects" attribution)
  meetingOwnerId: text("meeting_owner_id"),
  // Human-readable disposition label of the most recent qualifying call
  // within the campaign window (e.g. "Connected - 01 - Pitch", "Connected -
  // 04 - Wrong Title") — kept for the contact drill-down list, so users can
  // see what actually happened on the call, not just a boolean.
  lastCallDispositionLabel: text("last_call_disposition_label"),
  lastCallAt: timestamp("last_call_at"),
  // The most recent call that specifically classified as "connected" — kept
  // separate from lastCallDispositionLabel above because a contact can be
  // connected once and then get a later no-answer follow-up; showing the
  // latest call's label in that case would misreport why they count as a
  // connect at all.
  lastConnectedCallDispositionLabel: text("last_connected_call_disposition_label"),
  lastConnectedCallAt: timestamp("last_connected_call_at"),
  lastMeetingAt: timestamp("last_meeting_at"),
  // hs_meeting_outcome of the most recent meeting within window: SCHEDULED /
  // COMPLETED / RESCHEDULED / NO_SHOW / CANCELED.
  lastMeetingOutcome: text("last_meeting_outcome"),
  // SQO = a deal reached "Pre-Assessment Questions" or "System Overview" in
  // the Marketing Pipeline. SQL = a deal exists in the Sales Pipeline at all
  // (any stage). Both are portal-specific pipeline/stage IDs, defined by the
  // user — see SQO_STAGE_IDS / SALES_PIPELINE_ID in lib/sync.ts.
  sqoReached: boolean("sqo_reached").notNull().default(false),
  sqlReached: boolean("sql_reached").notNull().default(false),
  hasGenuineReply: boolean("has_genuine_reply").notNull().default(false),
  meetingBooked: boolean("meeting_booked").notNull().default(false),
  lastSyncedAt: timestamp("last_synced_at"),
});

export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull().default("running"), // running | success | error
  errorMessage: text("error_message"),
});

// Small editable key/value config store — e.g. `authority_keywords` (jsonb string[])
// and `call_disposition_map` (jsonb) once the portal's actual disposition values are known.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
