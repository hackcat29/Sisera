"use client";

import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ArrowUpRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { MarketRow } from "../lib/api";
import { DeltaBadge } from "./delta-badge";

export function MarketScreener({
  rows,
  venue,
}: { rows: MarketRow[]; venue: "binance" | "hyperliquid" }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "volume", desc: true }]);
  const [filter, setFilter] = useState("");
  const columns = useMemo<ColumnDef<MarketRow>[]>(
    () => [
      {
        id: "market",
        accessorFn: (row) => row.instrument.displaySymbol,
        header: "Market",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-[#2b3b43] font-mono text-sm font-semibold text-[#e9bd8c]">
              {row.original.instrument.baseAsset.slice(0, 1)}
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-100">
                {row.original.instrument.displaySymbol}
              </p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                {row.original.instrument.venue} · {row.original.instrument.type}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: "price",
        accessorFn: (row) => Number(row.snapshot.last),
        header: "Last price",
        cell: ({ row }) => (
          <span className="font-mono text-[13px] text-slate-100">
            $
            {Number(row.original.snapshot.last).toLocaleString(undefined, {
              maximumFractionDigits: 6,
            })}
          </span>
        ),
      },
      {
        id: "change",
        accessorFn: (row) => Number(row.snapshot.change24hPct ?? 0),
        header: "24h change",
        cell: ({ row }) => <DeltaBadge value={row.original.snapshot.change24hPct} />,
      },
      {
        id: "volume",
        accessorFn: (row) => Number(row.snapshot.volume24h ?? 0),
        header: "24h volume",
        cell: ({ row }) => (
          <span className="font-mono text-[13px] text-slate-200">
            {formatCompact(row.original.snapshot.volume24h)}
          </span>
        ),
      },
      {
        id: "spread",
        accessorFn: (row) => Number(row.snapshot.ask) - Number(row.snapshot.bid),
        header: "Spread",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-300">{spreadBps(row.original)} bps</span>
        ),
      },
      {
        id: "source",
        accessorFn: (row) => row.snapshot.quality.source,
        header: "Source",
        cell: ({ row }) => (
          <div>
            <p className="font-mono text-[11px] text-slate-200">
              {row.original.instrument.venue} {row.original.instrument.type}
            </p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">
              {row.original.snapshot.quality.status} ·{" "}
              {new Intl.DateTimeFormat("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hourCycle: "h23",
                timeZone: "UTC",
              }).format(new Date(row.original.snapshot.quality.observedAt))}{" "}
              UTC
            </p>
          </div>
        ),
      },
      {
        id: "action",
        enableSorting: false,
        header: "",
        cell: ({ row }) => (
          <Link
            href={
              venue === "binance"
                ? `/spot/${row.original.instrument.baseAsset}USDT`
                : `/terminal?symbol=${row.original.instrument.baseAsset}USDT&venue=hyperliquid`
            }
            className="inline-flex h-9 items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-400/[0.08] px-3 text-xs font-medium text-cyan-300 hover:bg-cyan-400/[0.14]"
          >
            Open <ArrowUpRight size={13} />
          </Link>
        ),
      },
    ],
    [venue],
  );
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            {venue === "hyperliquid" ? "Perpetual markets" : "Spot markets"}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Latest observed quotes and 24-hour activity from{" "}
            {venue === "hyperliquid" ? "Hyperliquid" : "Binance"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-[#0f1a22] px-3">
            <Search size={14} className="text-slate-400" />
            <input
              aria-label="Filter instruments"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search markets"
              className="w-40 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500"
            />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-xs">
          <thead className="bg-[#101b23] text-slate-400">
            <tr>
              {table.getHeaderGroups()[0]?.headers.map((header) => (
                <th
                  key={header.id}
                  className="h-11 border-b border-line px-5 font-mono text-[10px] font-medium uppercase tracking-wider"
                >
                  <button
                    type="button"
                    onClick={header.column.getToggleSortingHandler()}
                    className="flex items-center gap-1.5"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && <ArrowUpDown size={10} />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-line transition-colors hover:bg-white/[0.035]"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="h-16 px-5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-5 py-10 text-center text-sm text-slate-400"
                >
                  No markets match this search. Try a symbol or asset name.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex h-12 items-center justify-between border-t border-line px-5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
        <span>{table.getRowModel().rows.length} markets shown</span>
        <span>Quote status and observed time shown per market</span>
      </div>
    </section>
  );
}

function spreadBps(row: MarketRow) {
  const mid = (Number(row.snapshot.bid) + Number(row.snapshot.ask)) / 2;
  return mid === 0
    ? "—"
    : (((Number(row.snapshot.ask) - Number(row.snapshot.bid)) / mid) * 10_000).toFixed(2);
}
function formatCompact(value?: string) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(
        number,
      )
    : "—";
}
