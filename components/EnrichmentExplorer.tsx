"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  getEnrichmentRunSnapshot,
  pushDirectPhoneToHubspot,
  triggerEnrichmentStage,
} from "@/app/(dashboard)/enrichment/actions";
import type { EnrichmentRowItem, EnrichmentRunListItem } from "@/lib/queries";
import { ALL_STAGES, EMAIL_STAGES, MOBILE_STAGES, STAGE_LABELS, type Stage } from "@/lib/enrichment/stages";

const RUNNING_STATUSES = new Set(["queued", "running"]);
const POLL_INTERVAL_MS = 2500;
const RETRIABLE_STATUSES = new Set(["pending", "no_match", "error", "rejected"]);

const SOURCE_COLUMN_IDS = ["name", "companyName", "domain"];
const ENRICHMENT_COLUMN_IDS = [
  "email",
  "emailStatus",
  "emailSource",
  "mobile",
  "mobileStatus",
  "mobileSource",
  "creditsConsumed",
  "directPhonePushStatus",
];

// Lets the Email/Mobile column-group headers fire a scoped waterfall
// directly from the table (Clay-style "run this column"), without every
// header render needing a fresh column-def identity — read off the live
// `table` object at render time instead of closing over component state.
type EnrichmentTableMeta = {
  isBusy: boolean;
  onRunEmail: () => void;
  onRunMobile: () => void;
};

const inputStyle = { borderColor: "var(--border-hairline)", color: "var(--text-primary)" };

// Header background tint by section, applied to both the top-level "Enrichment"
// group cell and its leaf columns, so the whole section reads as one visual
// block against the neutral Source Data columns.
function headerTint(id: string): string | null {
  if (id === "enrichment" || ENRICHMENT_COLUMN_IDS.includes(id)) return "var(--series-blue)";
  return null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "var(--text-muted)",
  pending: "var(--text-muted)",
  found: "var(--series-aqua)",
  no_match: "var(--text-muted)",
  rejected: "var(--series-orange)",
  error: "var(--series-red)",
  skipped: "var(--text-muted)",
  not_pushed: "var(--text-muted)",
  pushed: "var(--series-aqua)",
  skipped_duplicate: "var(--text-muted)",
};

// Shared cell renderer: empty values fade to text-muted so populated data
// visually pops against a sheet full of "—" placeholders; phone/email
// columns render in a monospace tabular face to line up like a real data
// grid instead of proportional body text.
function DataCell({ value, mono }: { value: string | null | undefined; mono?: boolean }) {
  if (!value) {
    return (
      <span style={{ color: "var(--text-muted)" }} aria-hidden>
        —
      </span>
    );
  }
  return (
    <span className={mono ? "font-mono tabular-nums" : undefined} style={{ color: "var(--text-primary)" }}>
      {value}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "var(--text-muted)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      {status.replace("_", " ")}
    </span>
  );
}

// Play-button control embedded directly in the Email/Mobile column headers
// (Clay-style "run this column") — a filled circle so it reads as a clickable
// control against the header row rather than blending into the label text.
// Pill that reflects whether its column group is currently shown — filled
// and tinted with the section's color when visible, a plain outline when
// hidden, so the toggle row doubles as a legend for the header tints below.
function GroupToggleButton({ label, color, visible, onClick }: { label: string; color: string; visible: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition"
      style={
        visible
          ? { background: `color-mix(in srgb, ${color} 18%, transparent)`, borderColor: color, color }
          : { borderColor: "var(--border-hairline)", color: "var(--text-muted)", background: "transparent" }
      }
    >
      {label}
    </button>
  );
}

function ColumnGroupHeader({ label, title, onRun, disabled }: { label: string; title: string; onRun: () => void; disabled: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <span>{label}</span>
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onRun();
        }}
        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-[10px] normal-case transition disabled:cursor-not-allowed disabled:opacity-30"
        style={{ background: "rgba(14, 165, 183, 0.16)", color: "var(--series-blue)" }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "rgba(14, 165, 183, 0.32)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(14, 165, 183, 0.16)";
        }}
      >
        ▶
      </button>
    </div>
  );
}

function RunProgress({ run }: { run: EnrichmentRunListItem }) {
  const pct = run.totalRows > 0 ? Math.round((run.processedRows / run.totalRows) * 100) : 0;
  return (
    <div className="hud-panel space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium" style={{ color: "var(--text-primary)" }}>
            {run.label ?? `Run #${run.id}`}
          </span>
          <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
            {run.campaignName ?? "—"}
          </span>
        </div>
        <StatusBadge status={run.status} />
      </div>
      {RUNNING_STATUSES.has(run.status) && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--gridline)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: "var(--series-blue)" }}
            />
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {run.currentStage ? `Running: ${run.currentStage.replace(/_/g, " ")} — ` : ""}
            {run.processedRows}/{run.totalRows} rows
          </p>
        </div>
      )}
      {run.status === "error" && run.errorMessage && (
        <p className="text-xs" style={{ color: "var(--series-red)" }}>
          {run.errorMessage}
        </p>
      )}
      {run.status === "draft" && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Loaded — nothing enriched yet. Select rows (optional) and click a stage below to run it.
        </p>
      )}
    </div>
  );
}

export function EnrichmentExplorer({
  runId,
  initialRun,
  initialRows,
}: {
  runId: number;
  initialRun: EnrichmentRunListItem | null;
  initialRows: EnrichmentRowItem[];
}) {
  const [run, setRun] = useState(initialRun);
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [isTriggering, setIsTriggering] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

  useEffect(() => {
    setRun(initialRun);
    setRows(initialRows);
    setRowSelection({});
  }, [runId, initialRun, initialRows]);

  useEffect(() => {
    if (!run || !RUNNING_STATUSES.has(run.status)) return;
    const interval = setInterval(async () => {
      const snapshot = await getEnrichmentRunSnapshot(runId);
      setRun(snapshot.run);
      setRows(snapshot.rows);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [runId, run]);

  const columns = useMemo<ColumnDef<EnrichmentRowItem>[]>(
    () => [
      {
        id: "rowIndex",
        header: "#",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums" style={{ color: "var(--text-muted)" }}>
            {row.index + 1}
          </span>
        ),
        enableSorting: false,
        size: 40,
      },
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
        ),
        enableSorting: false,
        size: 32,
      },
      {
        id: "source",
        header: "Source Data",
        columns: [
          {
            id: "name",
            header: "Name",
            accessorFn: (r) => [r.firstName, r.lastName].filter(Boolean).join(" ") || "(no name)",
          },
          {
            id: "companyName",
            header: "Company",
            accessorKey: "companyName",
            cell: (ctx) => <DataCell value={ctx.getValue<string | null>()} />,
          },
          {
            id: "domain",
            header: "Domain",
            accessorKey: "domain",
            cell: (ctx) => <DataCell value={ctx.getValue<string | null>()} mono />,
          },
        ],
      },
      {
        id: "enrichment",
        header: "Enrichment",
        // Deliberately flat (no emailGroup/mobileGroup sub-level) — a nested
        // group here but not under Source Data gave the two sections
        // mismatched header depths, which is what actually caused the
        // "Email"/"Mobile" labels to render twice stacked on top of each
        // other. One consistent depth for every group now.
        columns: [
          {
            id: "email",
            header: ({ table }) => {
              const meta = table.options.meta as EnrichmentTableMeta;
              return (
                <ColumnGroupHeader
                  label="Email"
                  title="Run full email waterfall (HubSpot → LeadMagic → Prospeo → ZeroBounce)"
                  onRun={meta.onRunEmail}
                  disabled={meta.isBusy}
                />
              );
            },
            accessorKey: "email",
            enableSorting: false,
            cell: (ctx) => <DataCell value={ctx.getValue<string | null>()} mono />,
          },
          {
            id: "emailStatus",
            header: "Email Status",
            accessorKey: "emailStatus",
            cell: (ctx) => <StatusBadge status={ctx.getValue<string>()} />,
          },
          {
            id: "emailSource",
            header: "Email Source",
            accessorKey: "emailSource",
            cell: (ctx) => <DataCell value={ctx.getValue<string | null>()} />,
          },
          {
            id: "mobile",
            header: ({ table }) => {
              const meta = table.options.meta as EnrichmentTableMeta;
              return (
                <ColumnGroupHeader
                  label="Mobile Phone"
                  title="Run full mobile waterfall (HubSpot → LeadMagic → Prospeo)"
                  onRun={meta.onRunMobile}
                  disabled={meta.isBusy}
                />
              );
            },
            accessorKey: "mobile",
            enableSorting: false,
            cell: (ctx) => <DataCell value={ctx.getValue<string | null>()} mono />,
          },
          {
            id: "mobileStatus",
            header: "Mobile Status",
            accessorKey: "mobileStatus",
            cell: (ctx) => <StatusBadge status={ctx.getValue<string>()} />,
          },
          {
            id: "mobileSource",
            header: "Mobile Source",
            accessorKey: "mobileSource",
            cell: (ctx) => <DataCell value={ctx.getValue<string | null>()} />,
          },
          {
            id: "directPhonePushStatus",
            header: "Direct Phone Push",
            accessorKey: "directPhonePushStatus",
            cell: (ctx) => <StatusBadge status={ctx.getValue<string>()} />,
          },
          {
            id: "creditsConsumed",
            header: "Credits",
            accessorKey: "creditsConsumed",
          },
        ],
      },
    ],
    [],
  );

  const selectedRowIds = Object.entries(rowSelection)
    .filter(([, selected]) => selected)
    .map(([id]) => Number(id));

  const isBusy = isTriggering || isPushing || (run ? RUNNING_STATUSES.has(run.status) : false);

  async function handleTriggerStage(stages: Stage[] | undefined) {
    setIsTriggering(true);
    try {
      const rowIds = selectedRowIds.length > 0 ? selectedRowIds : undefined;
      await triggerEnrichmentStage(runId, stages, rowIds);
      const snapshot = await getEnrichmentRunSnapshot(runId);
      setRun(snapshot.run);
      setRows(snapshot.rows);
      setRowSelection({});
    } finally {
      setIsTriggering(false);
    }
  }

  async function handlePushToHubspot() {
    setIsPushing(true);
    try {
      const rowIds = selectedRowIds.length > 0 ? selectedRowIds : undefined;
      await pushDirectPhoneToHubspot(runId, rowIds);
      const snapshot = await getEnrichmentRunSnapshot(runId);
      setRun(snapshot.run);
      setRows(snapshot.rows);
      setRowSelection({});
    } finally {
      setIsPushing(false);
    }
  }

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: search, rowSelection, columnVisibility },
    getRowId: (row) => String(row.id),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const needle = String(filterValue).toLowerCase();
      const name = [row.original.firstName, row.original.lastName].filter(Boolean).join(" ");
      return [name, row.original.companyName, row.original.email, row.original.mobile]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle));
    },
    meta: {
      isBusy,
      onRunEmail: () => handleTriggerStage(EMAIL_STAGES as Stage[]),
      onRunMobile: () => handleTriggerStage(MOBILE_STAGES as Stage[]),
    } satisfies EnrichmentTableMeta,
  });

  function toggleGroup(ids: string[]) {
    const anyVisible = ids.some((id) => table.getColumn(id)?.getIsVisible() ?? true);
    for (const id of ids) table.getColumn(id)?.toggleVisibility(!anyVisible);
  }

  const emailRetriableCount = rows.filter((r) => RETRIABLE_STATUSES.has(r.emailStatus)).length;
  const mobileRetriableCount = rows.filter((r) => RETRIABLE_STATUSES.has(r.mobileStatus)).length;

  function stageDisabled(stage: Stage): boolean {
    if (isBusy) return true;
    if (selectedRowIds.length > 0) return false;
    const isMobileStage = stage === "leadmagic_mobile" || stage === "prospeo_mobile";
    return isMobileStage ? mobileRetriableCount === 0 : emailRetriableCount === 0;
  }

  const foundEmail = rows.filter((r) => r.emailStatus === "found").length;
  const foundMobile = rows.filter((r) => r.mobileStatus === "found").length;
  const totalCredits = rows.reduce((sum, r) => sum + r.creditsConsumed, 0);
  const pendingPushCount = rows.filter(
    (r) => r.mobileStatus === "found" && r.directPhonePushStatus === "not_pushed",
  ).length;

  if (!run) return null;

  return (
    <div className="space-y-4">
      <RunProgress run={run} />

      <div className="hud-panel space-y-2 p-4">
        <p className="hud-heading text-xs" style={{ color: "var(--text-secondary)" }}>
          Run a stage {selectedRowIds.length > 0 ? `on ${selectedRowIds.length} selected row(s)` : "on all eligible rows"}
        </p>
        <div className="flex flex-wrap gap-2">
          {ALL_STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              disabled={stageDisabled(stage)}
              onClick={() => handleTriggerStage([stage])}
              className="hud-button rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            >
              {STAGE_LABELS[stage]}
            </button>
          ))}
          <button
            type="button"
            disabled={isBusy}
            onClick={() => handleTriggerStage(undefined)}
            className="hud-button rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: "var(--series-blue)" }}
          >
            Run All (full waterfall)
          </button>
        </div>
      </div>

      {pendingPushCount > 0 && (
        <div
          className="hud-panel flex flex-wrap items-center justify-between gap-3 p-4"
          style={{ borderColor: "var(--series-blue)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {selectedRowIds.length > 0
              ? `${selectedRowIds.length} row(s) selected — push their mobile number to HubSpot's Direct Phone field?`
              : `${pendingPushCount} new mobile number(s) found — push to HubSpot's Direct Phone field?`}
            {" "}Numbers already matching an existing phone field on the contact are skipped automatically.
          </p>
          <button
            type="button"
            disabled={isBusy}
            onClick={handlePushToHubspot}
            className="hud-button shrink-0 rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPushing ? "Pushing…" : "Push to HubSpot"}
          </button>
        </div>
      )}

      <div className="hud-panel space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search name, company, email, mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 rounded border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            style={inputStyle}
          />
          <GroupToggleButton
            label="Source"
            color="var(--text-secondary)"
            visible={SOURCE_COLUMN_IDS.some((id) => table.getColumn(id)?.getIsVisible() ?? true)}
            onClick={() => toggleGroup(SOURCE_COLUMN_IDS)}
          />
          <GroupToggleButton
            label="Enrichment"
            color="var(--series-blue)"
            visible={ENRICHMENT_COLUMN_IDS.some((id) => table.getColumn(id)?.getIsVisible() ?? true)}
            onClick={() => toggleGroup(ENRICHMENT_COLUMN_IDS)}
          />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {rows.length} contacts — {foundEmail} emails found, {foundMobile} mobiles found, {totalCredits} credits
            used
          </p>
        </div>
      </div>

      <div className="hud-panel">
        <div className="max-h-[70vh] overflow-auto rounded-lg">
          <table className="w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup, groupIndex) => (
                <tr key={headerGroup.id} className="hud-heading text-xs">
                  {headerGroup.headers.map((header) => {
                    const tint = headerTint(header.id);
                    const cellStyle: CSSProperties = {
                      borderBottom: "1px solid var(--border-hairline)",
                      background: tint
                        ? `color-mix(in srgb, ${tint} ${groupIndex === 0 ? 14 : 9}%, var(--chart-surface))`
                        : "var(--chart-surface)",
                      position: "sticky",
                      top: groupIndex * 37,
                      zIndex: 10 - groupIndex,
                    };
                    if (header.isPlaceholder) {
                      return <th key={header.id} colSpan={header.colSpan} rowSpan={header.rowSpan} style={cellStyle} />;
                    }
                    if (!header.column.getCanSort()) {
                      return (
                        <th
                          key={header.id}
                          colSpan={header.colSpan}
                          rowSpan={header.rowSpan}
                          className="whitespace-nowrap px-4 py-3 text-center font-medium"
                          style={cellStyle}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      );
                    }
                    return (
                      <th
                        key={header.id}
                        colSpan={header.colSpan}
                        rowSpan={header.rowSpan}
                        className="whitespace-nowrap px-4 py-3 font-medium"
                        style={cellStyle}
                      >
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex cursor-pointer items-center gap-1"
                          style={{
                            color: header.column.getIsSorted() ? "var(--text-primary)" : "var(--text-secondary)",
                          }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span style={{ opacity: header.column.getIsSorted() ? 1 : 0.3 }}>
                            {header.column.getIsSorted() === "desc" ? "▼" : "▲"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 && (
                <tr>
                  <td
                    colSpan={table.getVisibleLeafColumns().length}
                    className="px-4 py-6 text-center"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No contacts match this search.
                  </td>
                </tr>
              )}
              {table.getRowModel().rows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className="border-t transition-colors hover:brightness-125"
                  style={{
                    borderColor: "var(--gridline)",
                    background: row.getIsSelected()
                      ? "rgba(14, 165, 183, 0.14)"
                      : rowIndex % 2 === 1
                        ? "rgba(255, 255, 255, 0.015)"
                        : undefined,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
