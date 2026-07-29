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
  // Did this contact have a real back-and-forth on a call, not just a
  // pickup? Scoped to disposition labels "Connected - 01 - Pitch",
  // "Connected - 02 - Past Pitch", "Connected - 03 - Meeting" specifically —
  // a strict subset of lastCallConnected (excludes bare "Connected" and
  // "Connected - 04 - Wrong Title"). Powers the "Conversation → Meeting
  // Rate" metric — see isConversation in lib/sync.ts.
  hadConversation: boolean("had_conversation").notNull().default(false),
  lastSyncedAt: timestamp("last_synced_at"),
});

// One row per individual HubSpot call (not aggregated) — powers the daily
// calls/connects chart. `contactId`/`companyId`/`ownerId` are soft
// references, same rationale as on `contacts`: a call can reference a
// contact/company/owner that's been deleted or archived in HubSpot, and a
// hard FK there would abort the whole sync over a single dangling reference.
export const callEvents = pgTable("call_events", {
  hubspotCallId: text("hubspot_call_id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  contactId: text("contact_id"),
  companyId: text("company_id"),
  ownerId: text("owner_id"),
  dispositionLabel: text("disposition_label"),
  // Precomputed classification (mirrors classifyDispositionLabel in
  // lib/sync.ts) so the daily chart query doesn't need fragile string
  // matching: 'connected' = real Connected* disposition, 'wrong' = Wrong
  // Title / Wrong Number specifically, 'other' = everything else.
  dispositionCategory: text("disposition_category").notNull(),
  calledAt: timestamp("called_at"),
});

// One row per individual HubSpot meeting (not aggregated) — same rationale
// as callEvents: contacts.lastMeetingAt/meetingBooked is a single
// latest-snapshot per contact scoped to one campaign's sync window, which
// can't answer "what did this rep book in the last 30 days across every
// campaign." Soft references, same as callEvents.
export const meetingEvents = pgTable("meeting_events", {
  hubspotMeetingId: text("hubspot_meeting_id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  contactId: text("contact_id"),
  companyId: text("company_id"),
  ownerId: text("owner_id"),
  outcome: text("outcome"), // hs_meeting_outcome
  meetingAt: timestamp("meeting_at"), // hs_timestamp
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

// One row per enrichment pipeline run (LeadMagic/Prospeo/ZeroBounce waterfall),
// mirrors syncRuns' job-bookkeeping shape. campaignId is nullable — a run can
// target an ad hoc contact list not yet tied to a campaign.
export const enrichmentRuns = pgTable("enrichment_runs", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  label: text("label"),
  status: text("status").notNull().default("queued"), // draft | queued | running | success | error | partial
  currentStage: text("current_stage"),
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  triggerSource: text("trigger_source").notNull(), // manual_ui | chat
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  errorMessage: text("error_message"),
});

// The stable per-contact row identity the CLI pipeline (Enrichment/) lacks —
// each pipeline stage upserts onto this row as it processes it, instead of
// writing one all-or-nothing CSV at the very end, so a crashed run leaves
// real, queryable partial state. contactId is a soft reference, same
// rationale as contacts.companyId/ownerId above: a row may not yet correspond
// to a synced HubSpot contact (e.g. a freshly uploaded prospect list), and a
// hard FK would abort the insert on any row that doesn't resolve.
export const enrichmentRows = pgTable("enrichment_rows", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => enrichmentRuns.id, { onDelete: "cascade" }),
  contactId: text("contact_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  companyName: text("company_name"),
  domain: text("domain"),
  // Snapshot of the linked HubSpot contact's own fields, captured at row
  // creation (see triggerEnrichmentRun in actions.ts) — shown as their own
  // "Current" columns in the spreadsheet so the user can see what's already
  // on file before running anything. Always null for CSV-uploaded rows
  // (contactId is null — no HubSpot record to read). Not kept in sync after
  // creation; pushDirectPhoneToHubspot always re-fetches live at push time
  // rather than trusting this snapshot.
  currentEmail: text("current_email"),
  currentPhone: text("current_phone"),
  currentWorkPhone: text("current_work_phone"),
  currentMobilePhone: text("current_mobile_phone"),
  currentDirectPhone: text("current_direct_phone"),
  emailStatus: text("email_status").notNull().default("pending"), // pending | found | no_match | rejected | error | skipped
  email: text("email"),
  emailSource: text("email_source"), // existing | leadmagic | prospeo
  emailZeroBounceStatus: text("email_zerobounce_status"),
  mobileStatus: text("mobile_status").notNull().default("pending"), // pending | found | no_match | rejected | error | skipped
  mobile: text("mobile"),
  mobileSource: text("mobile_source"), // leadmagic | prospeo
  // Tracks writing a newly-found mobile back to HubSpot's direct_phone
  // property — separate from mobileStatus because "found" just means our
  // waterfall resolved it; this tracks whether it's actually been pushed to
  // the live CRM yet, gated on a manual confirm (see pushDirectPhoneToHubspot
  // in app/(dashboard)/enrichment/actions.ts) since this is the app's first
  // write path into HubSpot.
  directPhonePushStatus: text("direct_phone_push_status").notNull().default("not_pushed"), // not_pushed | pushed | skipped_duplicate | error
  directPhonePushedAt: timestamp("direct_phone_pushed_at"),
  creditsConsumed: integer("credits_consumed").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Append-only per-attempt audit log — one row per provider call against an
// enrichment row. Powers the chat panel's "explain why this contact's
// enrichment failed" tool and per-run credit accounting; enrichmentRows only
// holds current state, this holds the history that got it there.
export const enrichmentFieldEvents = pgTable("enrichment_field_events", {
  id: serial("id").primaryKey(),
  enrichmentRowId: integer("enrichment_row_id")
    .notNull()
    .references(() => enrichmentRows.id, { onDelete: "cascade" }),
  field: text("field").notNull(), // email | mobile
  provider: text("provider").notNull(), // leadmagic | prospeo | zerobounce | zoominfo
  outcome: text("outcome").notNull(), // found | no_match | rejected | error | skipped
  value: text("value"),
  creditsConsumed: integer("credits_consumed").notNull().default(0),
  errorMessage: text("error_message"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});
