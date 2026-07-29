"use client";

import { useState, useTransition } from "react";
import {
  parseEnrichmentCsv,
  triggerEnrichmentRun,
  triggerEnrichmentRunFromRows,
} from "@/app/(dashboard)/enrichment/actions";

const inputStyle = { borderColor: "var(--border-hairline)", color: "var(--text-primary)" };

type CampaignOption = { id: number; name: string; authorityContacts: number; totalContacts: number };

type MappingKey =
  | "firstName"
  | "lastName"
  | "companyName"
  | "domain"
  | "email"
  | "phone"
  | "workPhone"
  | "mobilePhone"
  | "directPhone";

type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
  detectedMapping: Record<MappingKey, string | null>;
};

const IDENTITY_FIELDS: { key: MappingKey; label: string; required: boolean }[] = [
  { key: "firstName", label: "First Name", required: true },
  { key: "lastName", label: "Last Name", required: true },
  { key: "companyName", label: "Company Name", required: false },
  { key: "domain", label: "Domain", required: false },
];

// Optional — if the CSV already has these (e.g. a HubSpot CRM export),
// mapping them shows the data immediately as "Current" columns and skips
// enrichment for any row that already has it, instead of re-spending
// credits re-finding data that was already sitting in the file.
const EXISTING_DATA_FIELDS: { key: MappingKey; label: string; required: boolean }[] = [
  { key: "email", label: "Email", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "workPhone", label: "Work Phone", required: false },
  { key: "mobilePhone", label: "Mobile Phone", required: false },
  { key: "directPhone", label: "Direct Phone", required: false },
];

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-full border px-3 py-1 text-xs transition"
      style={
        active
          ? { background: "var(--series-blue)", borderColor: "var(--series-blue)", color: "#fff" }
          : { borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }
      }
    >
      {children}
    </button>
  );
}

export function StartEnrichmentPanel({ campaignOptions }: { campaignOptions: CampaignOption[] }) {
  const [mode, setMode] = useState<"campaign" | "csv">("campaign");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<MappingKey, string>>({
    firstName: "",
    lastName: "",
    companyName: "",
    domain: "",
    email: "",
    phone: "",
    workPhone: "",
    mobilePhone: "",
    directPhone: "",
  });
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    try {
      const result = await parseEnrichmentCsv(formData);
      if (result.rows.length === 0) {
        setError("That CSV has no rows.");
        return;
      }
      setParsed(result);
      setMapping({
        firstName: result.detectedMapping.firstName ?? "",
        lastName: result.detectedMapping.lastName ?? "",
        companyName: result.detectedMapping.companyName ?? "",
        domain: result.detectedMapping.domain ?? "",
        email: result.detectedMapping.email ?? "",
        phone: result.detectedMapping.phone ?? "",
        workPhone: result.detectedMapping.workPhone ?? "",
        mobilePhone: result.detectedMapping.mobilePhone ?? "",
        directPhone: result.detectedMapping.directPhone ?? "",
      });
      setLabel(file.name.replace(/\.csv$/i, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse CSV");
    }
  }

  function handleConfirm() {
    if (!parsed) return;
    if (!mapping.firstName || !mapping.lastName) {
      setError("Map at least First Name and Last Name to a column.");
      return;
    }
    setError(null);
    startTransition(async () => {
      await triggerEnrichmentRunFromRows(
        parsed.rows,
        {
          firstName: mapping.firstName,
          lastName: mapping.lastName,
          companyName: mapping.companyName || null,
          domain: mapping.domain || null,
          email: mapping.email || null,
          phone: mapping.phone || null,
          workPhone: mapping.workPhone || null,
          mobilePhone: mapping.mobilePhone || null,
          directPhone: mapping.directPhone || null,
        },
        label,
      );
    });
  }

  return (
    <div className="hud-panel space-y-3 p-4">
      <div className="flex gap-2">
        <Tab active={mode === "campaign"} onClick={() => setMode("campaign")}>
          Existing campaign
        </Tab>
        <Tab active={mode === "csv"} onClick={() => setMode("csv")}>
          Upload CSV
        </Tab>
      </div>

      {mode === "campaign" && (
        <form action={triggerEnrichmentRun} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--text-secondary)" }}>
              Campaign
            </label>
            <select
              name="campaignId"
              required
              defaultValue=""
              className="rounded border bg-transparent px-2 py-1.5 text-sm"
              style={inputStyle}
            >
              <option value="" disabled>
                Select a campaign…
              </option>
              {campaignOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.authorityContacts} authority / {c.totalContacts} total
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" name="authorityOnly" defaultChecked />
            Authority contacts only
          </label>
          <button type="submit" className="hud-button rounded px-3 py-1.5 text-xs">
            Start Enrichment
          </button>
        </form>
      )}

      {mode === "csv" && (
        <div className="space-y-3">
          {!parsed && (
            <div>
              <label className="mb-1 block text-xs" style={{ color: "var(--text-secondary)" }}>
                CSV file
              </label>
              <input type="file" accept=".csv" onChange={handleFileChange} className="text-sm" />
            </div>
          )}
          {parsed && (
            <>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {parsed.rows.length} row(s) detected. Map columns (First/Last Name required):
              </p>
              <div className="flex flex-wrap gap-3">
                {IDENTITY_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="mb-1 block text-xs" style={{ color: "var(--text-secondary)" }}>
                      {field.label}
                      {field.required ? " *" : ""}
                    </label>
                    <select
                      value={mapping[field.key]}
                      onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                      className="rounded border bg-transparent px-2 py-1.5 text-sm"
                      style={inputStyle}
                    >
                      <option value="">—</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <div>
                  <label className="mb-1 block text-xs" style={{ color: "var(--text-secondary)" }}>
                    Run label
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="w-48 rounded border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                    style={inputStyle}
                  />
                </div>
              </div>

              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Existing data (optional) — mapping these shows what the file already has and skips enrichment for
                rows that already have it:
              </p>
              <div className="flex flex-wrap gap-3">
                {EXISTING_DATA_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="mb-1 block text-xs" style={{ color: "var(--text-secondary)" }}>
                      {field.label}
                    </label>
                    <select
                      value={mapping[field.key]}
                      onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                      className="rounded border bg-transparent px-2 py-1.5 text-sm"
                      style={inputStyle}
                    >
                      <option value="">—</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleConfirm}
                  className="hud-button rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPending ? "Starting…" : "Start Enrichment"}
                </button>
                <button
                  type="button"
                  onClick={() => setParsed(null)}
                  className="cursor-pointer text-xs hover:underline"
                  style={{ color: "var(--text-muted)" }}
                >
                  Choose a different file
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs" style={{ color: "var(--series-red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
