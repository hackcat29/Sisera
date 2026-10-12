"use client";

import { useState } from "react";
import type { AccountEvent } from "../lib/api";

export function ActivityTimeline({ events }: { events: AccountEvent[] }) {
  const [mode, setMode] = useState("all");
  const [source, setSource] = useState("all");
  const visible = events.filter(
    (event) =>
      (mode === "all" || event.mode === mode) && (source === "all" || event.source === source),
  );
  const sources = [...new Set(events.map((event) => event.source))];
  return (
    <section className="mb-4 border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Account event timeline</h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Immutable order state changes recorded from the current ledger migration onward.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <label>
            <span className="sr-only">Mode</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
              className="border border-line bg-ink p-2 text-slate-200"
            >
              <option value="all">All modes</option>
              <option value="live">Live</option>
              <option value="paper">Paper</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Source</span>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="border border-line bg-ink p-2 text-slate-200"
            >
              <option value="all">All sources</option>
              {sources.map((item) => (
                <option key={item} value={item}>
                  {item.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {visible.length ? (
        <div className="divide-y divide-line">
          {visible.map((event) => (
            <div
              key={event.id}
              className="grid gap-2 px-4 py-3 text-xs md:grid-cols-[150px_100px_120px_1fr]"
            >
              <span className="font-mono text-slate-500">
                {new Date(event.occurredAt).toLocaleString()}
              </span>
              <span className="font-mono uppercase text-slate-400">{event.mode}</span>
              <span
                className={
                  event.status === "failed" ||
                  event.status === "unknown" ||
                  event.status === "rejected"
                    ? "text-rose-300"
                    : "text-bronze-300"
                }
              >
                {event.status}
              </span>
              <span className="truncate text-slate-300">
                {event.detail.venue ?? event.source.replaceAll("_", " ")} ·{" "}
                {event.detail.symbol ??
                  event.detail.marketId ??
                  event.detail.requestId ??
                  event.sourceId}{" "}
                {event.detail.side ?? event.detail.outcome ?? ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="p-5 text-xs text-slate-400">No matching account events have been recorded.</p>
      )}
    </section>
  );
}
