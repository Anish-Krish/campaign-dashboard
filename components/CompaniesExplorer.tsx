"use client";

import { useMemo, useState } from "react";
import {
  ENGAGEMENT_LABELS,
  ENGAGEMENT_STATUSES,
  type EngagementStatus,
} from "@/lib/engagement-constants";
import type { CompanyExplorerContact, CompanyExplorerRow } from "@/lib/queries";

const STATUS_COLORS: Record<EngagementStatus, string> = {
  unengaged: "var(--text-muted)",
  not_interested: "var(--series-red)",
  unqualified: "var(--series-orange)",
  activated_lead: "var(--series-aqua)",
  meeting_booked: "var(--series-blue)",
};

type SortKey = "company" | "industry" | "contacts" | "calls" | "status";
type EnrolledFilter = "all" | "enrolled" | "not_enrolled";

const inputStyle = { borderColor: "var(--border-hairline)", color: "var(--text-primary)" };

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey | null;
  currentDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const active = currentKey === sortKey;
  return (
    <th className="px-4 py-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex cursor-pointer items-center gap-1"
        style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}
      >
        {label}
        <span style={{ opacity: active ? 1 : 0.3 }}>{active && currentDir === "desc" ? "▼" : "▲"}</span>
      </button>
    </th>
  );
}

function ContactList({ title, contacts }: { title: string; contacts: CompanyExplorerContact[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? contacts : contacts.slice(0, 3);

  if (contacts.length === 0) {
    return (
      <div>
        <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          {title}
        </div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          None
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {title} ({contacts.length})
      </div>
      <ul className="space-y-1">
        {visible.map((c) => (
          <li key={c.hubspotContactId} className="text-xs">
            <a
              href={c.hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline"
              style={{ color: "var(--series-blue)" }}
            >
              {c.name}
            </a>
            <span style={{ color: "var(--text-secondary)" }}>
              {c.jobTitle ? ` — ${c.jobTitle}` : ""} — {c.callCount} call{c.callCount === 1 ? "" : "s"}
              {c.dispositionLabel ? ` — ${c.dispositionLabel}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {contacts.length > 3 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="mt-1 cursor-pointer text-xs hover:underline"
          style={{ color: "var(--series-blue)" }}
        >
          {showAll ? "Show fewer" : `+${contacts.length - 3} more`}
        </button>
      )}
    </div>
  );
}

function CompanyExplorerRowItem({
  row,
  showCampaignColumn,
}: {
  row: CompanyExplorerRow;
  showCampaignColumn: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="cursor-pointer border-t hover:bg-white/5"
        style={{ borderColor: "var(--gridline)" }}
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
          {expanded ? "▾" : "▸"}
        </td>
        <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
          {row.companyName}
          {showCampaignColumn && (
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {row.campaignName ?? "—"}
            </div>
          )}
        </td>
        <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
          {row.industry ?? "—"}
        </td>
        <td className="px-4 py-3">
          {row.enrolled ? (
            <span style={{ color: "var(--series-aqua)" }}>Enrolled</span>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>Not enrolled</span>
          )}
        </td>
        <td className="px-4 py-3 tabular-nums">{row.contactCount}</td>
        <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
          {row.authorityContacts[0]?.name ?? "—"}
          {row.authorityContacts.length > 1 ? ` +${row.authorityContacts.length - 1}` : ""}
        </td>
        <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
          {row.championContacts.length === 0
            ? "—"
            : `${row.championContacts[0].name}${row.championContacts.length > 1 ? ` +${row.championContacts.length - 1}` : ""}`}
        </td>
        <td className="px-4 py-3 tabular-nums">{row.authorityCallCount}</td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: STATUS_COLORS[row.engagementStatus] }}
              aria-hidden
            />
            {ENGAGEMENT_LABELS[row.engagementStatus]}
          </span>
        </td>
        <td className="px-4 py-3">{row.sqoReached ? "Yes" : "—"}</td>
        <td className="px-4 py-3">{row.sqlReached ? "Yes" : "—"}</td>
      </tr>
      {expanded && (
        <tr className="border-t" style={{ borderColor: "var(--gridline)", background: "var(--background)" }}>
          <td />
          <td colSpan={10} className="px-4 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ContactList title="Authority" contacts={row.authorityContacts} />
              <ContactList title="Champions" contacts={row.championContacts} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function CompaniesExplorer({
  rows,
  showCampaignColumn = false,
}: {
  rows: CompanyExplorerRow[];
  showCampaignColumn?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<EngagementStatus>>(new Set());
  const [enrolledFilter, setEnrolledFilter] = useState<EnrolledFilter>("all");
  const [industryFilter, setIndustryFilter] = useState("");
  const [minCalls, setMinCalls] = useState("");
  const [mqlOnly, setMqlOnly] = useState(false);
  const [sqlOnly, setSqlOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const industries = useMemo(
    () => Array.from(new Set(rows.map((r) => r.industry).filter((v): v is string => Boolean(v)))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const minCallsNum = minCalls === "" ? null : Number(minCalls);
    return rows.filter((r) => {
      if (search && !r.companyName.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter.size > 0 && !statusFilter.has(r.engagementStatus)) return false;
      if (enrolledFilter === "enrolled" && !r.enrolled) return false;
      if (enrolledFilter === "not_enrolled" && r.enrolled) return false;
      if (industryFilter && r.industry !== industryFilter) return false;
      if (minCallsNum !== null && r.authorityCallCount < minCallsNum) return false;
      if (mqlOnly && !r.sqoReached) return false;
      if (sqlOnly && !r.sqlReached) return false;
      return true;
    });
  }, [rows, search, statusFilter, enrolledFilter, industryFilter, minCalls, mqlOnly, sqlOnly]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "company":
          return dir * a.companyName.localeCompare(b.companyName);
        case "industry":
          return dir * (a.industry ?? "").localeCompare(b.industry ?? "");
        case "contacts":
          return dir * (a.contactCount - b.contactCount);
        case "calls":
          return dir * (a.authorityCallCount - b.authorityCallCount);
        case "status":
          return dir * a.engagementStatus.localeCompare(b.engagementStatus);
        default:
          return 0;
      }
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  }

  function toggleStatus(status: EngagementStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter(new Set());
    setEnrolledFilter("all");
    setIndustryFilter("");
    setMinCalls("");
    setMqlOnly(false);
    setSqlOnly(false);
    setPage(1);
  }

  const hasFilters =
    search || statusFilter.size > 0 || enrolledFilter !== "all" || industryFilter || minCalls || mqlOnly || sqlOnly;

  return (
    <div className="space-y-4">
      <div className="hud-panel space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search companies…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-56 rounded border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            style={inputStyle}
          />
          <select
            value={enrolledFilter}
            onChange={(e) => {
              setEnrolledFilter(e.target.value as EnrolledFilter);
              setPage(1);
            }}
            className="rounded border bg-transparent px-2 py-1.5 text-sm"
            style={inputStyle}
          >
            <option value="all">All companies</option>
            <option value="enrolled">Enrolled only</option>
            <option value="not_enrolled">Not enrolled only</option>
          </select>
          <select
            value={industryFilter}
            onChange={(e) => {
              setIndustryFilter(e.target.value);
              setPage(1);
            }}
            className="rounded border bg-transparent px-2 py-1.5 text-sm"
            style={inputStyle}
          >
            <option value="">All industries</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            placeholder="Min calls"
            value={minCalls}
            onChange={(e) => {
              setMinCalls(e.target.value);
              setPage(1);
            }}
            className="w-28 rounded border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            style={inputStyle}
          />
          <Pill
            active={mqlOnly}
            onClick={() => {
              setMqlOnly((v) => !v);
              setPage(1);
            }}
          >
            MQL/SQO
          </Pill>
          <Pill
            active={sqlOnly}
            onClick={() => {
              setSqlOnly((v) => !v);
              setPage(1);
            }}
          >
            SQL
          </Pill>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="cursor-pointer text-xs hover:underline"
              style={{ color: "var(--text-muted)" }}
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {ENGAGEMENT_STATUSES.map((status) => (
            <Pill key={status} active={statusFilter.has(status)} onClick={() => toggleStatus(status)}>
              {ENGAGEMENT_LABELS[status]}
            </Pill>
          ))}
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Showing {sorted.length} of {rows.length} companies
        </p>
      </div>

      <div className="hud-panel">
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="hud-heading border-b text-xs" style={{ borderColor: "var(--border-hairline)" }}>
              <th className="px-4 py-3" />
              <SortHeader
                label="Company"
                sortKey="company"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Industry"
                sortKey="industry"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <th className="px-4 py-3 font-medium">Enrolled</th>
              <SortHeader
                label="# Contacts"
                sortKey="contacts"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <th className="px-4 py-3 font-medium">Authority Contact</th>
              <th className="px-4 py-3 font-medium">Champions</th>
              <SortHeader
                label="# Calls"
                sortKey="calls"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Status"
                sortKey="status"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <th className="px-4 py-3 font-medium">MQL/SQO</th>
              <th className="px-4 py-3 font-medium">SQL</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                  No companies match these filters.
                </td>
              </tr>
            )}
            {paginated.map((row) => (
              <CompanyExplorerRowItem
                key={`${row.campaignId}:${row.companyId}`}
                row={row}
                showCampaignColumn={showCampaignColumn}
              />
            ))}
          </tbody>
        </table>
      </div>
      </div>

      <div className="flex items-center justify-between text-sm" style={{ color: "var(--text-secondary)" }}>
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="rounded border bg-transparent px-2 py-1"
            style={inputStyle}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="hud-button cursor-pointer rounded px-3 py-1 text-xs disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="hud-button cursor-pointer rounded px-3 py-1 text-xs disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
