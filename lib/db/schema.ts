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

export const campaignCompanies = pgTable(
  "campaign_companies",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.hubspotCompanyId, { onDelete: "cascade" }),
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
  companyId: text("company_id").references(() => companies.hubspotCompanyId, {
    onDelete: "set null",
  }),
  ownerId: text("owner_id").references(() => owners.hubspotOwnerId, {
    onDelete: "set null",
  }),
  firstName: text("first_name"),
  lastName: text("last_name"),
  jobTitle: text("job_title"),
  isAuthority: boolean("is_authority").notNull().default(false),
  hasCallLogged: boolean("has_call_logged").notNull().default(false),
  lastCallConnected: boolean("last_call_connected").notNull().default(false),
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
