"use client";
import { useEffect, useState } from "react";
import { platform, usd } from "../../lib/platform";
import { Panel } from "./ui";

type Row = {
  rank: number | null;
  address: string;
  name: string;
  chain: string;
  pnlUsd: number | null;
  volumeUsd: number | null;
  trades: number | null;
  coveragePct: number | null;
  status: string;
  observedAt: string | null;
};
type Board = { rows: Row[]; totalTracked: number };
export function WalletLeaderboard() {
  const [window, setWindow] = useState("7d");
  const [search, setSearch] = useState("");
  const [address, setAddress] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    platform<Board>(`leaderboard?window=${window}&refresh=${revision}`)
      .then((data) => {
        if (active) setBoard(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [window, revision]);
  const rows =
    board?.rows.filter((r) =>
      `${r.address} ${r.name}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <div className="space-y-4">
      <Panel
        title="Rankings"
        actions={
          <span className="text-xs text-slate-500">{board?.totalTracked ?? "—"} traders</span>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          {["24h", "7d", "30d"].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={window === value}
              onClick={() => setWindow(value)}
              className={`border px-3 py-2 text-xs ${window === value ? "border-bronze-400 text-bronze-200" : "border-line text-slate-400"}`}
            >
              {value}
            </button>
          ))}
          <input
            aria-label="Search traders"
            placeholder="Search traders or wallets"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 border border-line bg-ink px-3 py-2 text-xs"
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => setRevision((v) => v + 1)}
            className="border border-line px-3 py-2 text-xs text-slate-400 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        {error && (
          <p role="alert" className="p-4 text-xs text-rose-200">
            {error}
          </p>
        )}
        {loading ? (
          <p className="p-5 text-xs text-slate-400">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[740px] text-left text-xs">
              <thead className="border-b border-line text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="p-4">Rank</th>
                  <th>Trader</th>
                  <th className="text-right">Realized P&amp;L</th>
                  <th className="text-right">Volume</th>
                  <th className="text-right">Trades</th>
                  <th className="p-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.address}>
                    <td className="p-4 font-mono text-slate-500">{row.rank ?? "—"}</td>
                    <td>
                      {row.chain === "solana" || row.chain === "evm" ? (
                        <a
                          href={
                            row.chain === "solana"
                              ? `https://solscan.io/account/${row.address}`
                              : `https://app.hyperliquid.xyz/explorer/address/${row.address}`
                          }
                          target="_blank"
                          rel="noreferrer"
                          title={row.address}
                          className="font-mono text-bronze-200"
                        >
                          {row.address.slice(0, 7)}…{row.address.slice(-6)} ↗
                        </a>
                      ) : (
                        <span className="font-mono text-bronze-200">{row.name}</span>
                      )}
                      <p className="mt-1 text-[10px] text-slate-500">
                        {row.chain === "evm"
                          ? "Hyperliquid"
                          : row.chain === "solana"
                            ? "Solana"
                            : row.chain}
                      </p>
                    </td>
                    <td
                      className={`text-right font-mono ${row.pnlUsd == null ? "text-slate-500" : row.pnlUsd >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                      {row.pnlUsd == null
                        ? "—"
                        : `${row.pnlUsd >= 0 ? "+" : "−"}${usd(Math.abs(row.pnlUsd))}`}
                    </td>
                    <td className="text-right font-mono text-slate-300">{usd(row.volumeUsd)}</td>
                    <td className="text-right font-mono text-slate-400">{row.trades ?? "—"}</td>
                    <td className="p-4 text-right text-[10px] text-amber-200">
                      {row.status.includes("partial") ? "Partial" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && !error && (
              <p className="p-6 text-xs text-slate-400">
                {search ? "No matches." : "No live trades yet."}
              </p>
            )}
          </div>
        )}
      </Panel>
      <Panel title="Track wallet">
        <form
          className="flex flex-col gap-3 p-4 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            platform("leaderboard/wallets", { body: { address } })
              .then(() => {
                setAddress("");
                setRevision((v) => v + 1);
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label className="flex-1 text-xs text-slate-400">
            Public wallet address
            <input
              required
              aria-label="Public wallet address"
              pattern="([1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Paste a wallet address"
              className="mt-1 w-full border border-line bg-ink px-3 py-2 text-xs"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="self-end border border-bronze-400/40 px-4 py-2 text-xs text-bronze-200 disabled:opacity-50"
          >
            {busy ? "Tracking…" : "Track wallet"}
          </button>
        </form>
      </Panel>
    </div>
  );
}
