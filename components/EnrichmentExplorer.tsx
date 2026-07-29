"use client";

import { useEffect, useMemo, useState } from "react";
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
import { ALL_STAGES, STAGE_LABELS, type Stage } from "@/lib/enrichment/stages";

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

const inputStyle = { borderColor: "var(--border-hairline)", color: "var(--text-primary)" };

const STATUS_COLORS: Record<string, string> = {
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

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: STATUS_COLORS[status] ?? "var(--text-muted)" }}
        aria-hidden
      />
      {status.replace("_", " ")}
    </span>
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
            cell: (ctx) => ctx.getValue<string | null>() ?? "—",
          },
          {
            id: "domain",
            header: "Domain",
            accessorKey: "domain",
            cell: (ctx) => ctx.getValue<string | null>() ?? "—",
          },
        ],
      },
      {
        id: "enrichment",
        header: "Enrichment",
        columns: [
          {
            id: "email",
            header: "Email",
            accessorKey: "email",
            cell: (ctx) => ctx.getValue<string | null>() ?? "—",
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
            cell: (ctx) => ctx.getValue<string | null>() ?? "—",
          },
          {
            id: "mobile",
            header: "Mobile",
            accessorKey: "mobile",
            cell: (ctx) => ctx.getValue<string | null>() ?? "—",
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
            cell: (ctx) => ctx.getValue<string | null>() ?? "—",
          },
          {
            id: "creditsConsumed",
            header: "Credits",
            accessorKey: "creditsConsumed",
          },
          {
            id: "directPhonePushStatus",
            header: "Direct Phone Push",
            accessorKey: "directPhonePushStatus",
            cell: (ctx) => <StatusBadge status={ctx.getValue<string>()} />,
          },
        ],
      },
    ],
    [],
  );

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
  });

  function toggleGroup(ids: string[]) {
    const anyVisible = ids.some((id) => table.getColumn(id)?.getIsVisible() ?? true);
    for (const id of ids) table.getColumn(id)?.toggleVisibility(!anyVisible);
  }

  const selectedRowIds = Object.entries(rowSelection)
    .filter(([, selected]) => selected)
    .map(([id]) => Number(id));

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

  const isBusy = isTriggering || isPushing || (run ? RUNNING_STATUSES.has(run.status) : false);
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
          <button
            type="button"
            onClick={() => toggleGroup(SOURCE_COLUMN_IDS)}
            className="cursor-pointer rounded-full border px-3 py-1 text-xs transition"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
          >
            Toggle Source columns
          </button>
          <button
            type="button"
            onClick={() => toggleGroup(ENRICHMENT_COLUMN_IDS)}
            className="cursor-pointer rounded-full border px-3 py-1 text-xs transition"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
          >
            Toggle Enrichment columns
          </button>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {rows.length} contacts — {foundEmail} emails found, {foundMobile} mobiles found, {totalCredits} credits
            used
          </p>
        </div>
      </div>

      <div className="hud-panel">
        <div className="overflow-x-auto rounded-lg">
          <table className="w-full text-left text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr
                  key={headerGroup.id}
                  className="hud-heading border-b text-xs"
                  style={{ borderColor: "var(--border-hairline)" }}
                >
                  {headerGroup.headers.map((header) => {
                    if (header.isPlaceholder) return <th key={header.id} colSpan={header.colSpan} rowSpan={header.rowSpan} />;
                    if (!header.column.getCanSort()) {
                      return (
                        <th
                          key={header.id}
                          colSpan={header.colSpan}
                          rowSpan={header.rowSpan}
                          className="px-4 py-3 text-center font-medium"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      );
                    }
                    return (
                      <th key={header.id} colSpan={header.colSpan} rowSpan={header.rowSpan} className="px-4 py-3 font-medium">
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
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t"
                  style={{ borderColor: "var(--gridline)", background: row.getIsSelected() ? "rgba(255,255,255,0.05)" : undefined }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
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
