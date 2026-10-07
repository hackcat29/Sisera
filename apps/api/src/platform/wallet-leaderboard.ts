import { createHash } from "node:crypto";
import {
  listLeaderboardLiveFills,
  listTrackedWallets,
  saveWalletPerformance,
  trackWallet,
} from "@sisera/db";
import { z } from "zod";
import { USDC_MINT } from "./catalog.js";

const History = z.array(
  z.object({
    signature: z.string(),
    timestamp: z.number(),
    type: z.string(),
    transactionError: z.unknown().optional(),
    tokenTransfers: z
      .array(
        z.object({
          mint: z.string(),
          tokenAmount: z.number(),
          fromUserAccount: z.string().nullable(),
          toUserAccount: z.string().nullable(),
        }),
      )
      .default([]),
  }),
);
export type WalletTransaction = z.infer<typeof History>[number];
export const WINDOWS = { "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400 } as const;

/** Realized gross USDC proceeds less FIFO basis. Unknown basis and unsupported quote assets are excluded. */
export function walletPerformance(
  address: string,
  transactions: WalletTransaction[],
  now = Date.now(),
) {
  const lots = new Map<string, Array<{ quantity: number; cost: number }>>();
  const results: Array<{
    timestamp: number;
    pnl: number;
    volume: number;
    matched: number;
    sold: number;
  }> = [];
  let unsupported = 0;
  const unique = [...new Map(transactions.map((t) => [t.signature, t])).values()].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  for (const tx of unique) {
    if (tx.transactionError) continue;
    const deltas = new Map<string, number>();
    for (const t of tx.tokenTransfers) {
      if (!Number.isFinite(t.tokenAmount) || t.tokenAmount <= 0) continue;
      const delta =
        (t.toUserAccount === address ? t.tokenAmount : 0) -
        (t.fromUserAccount === address ? t.tokenAmount : 0);
      deltas.set(t.mint, (deltas.get(t.mint) ?? 0) + delta);
    }
    const assets = [...deltas].filter(([mint, amount]) => mint !== USDC_MINT && amount !== 0);
    const cash = deltas.get(USDC_MINT) ?? 0;
    const asset = assets[0];
    if (tx.type !== "SWAP" || assets.length !== 1 || !asset || cash === 0 || asset[1] * cash >= 0) {
      // Transfers invalidate basis instead of attributing an incoming token's unknown cost to a sale.
      for (const [mint] of assets) lots.delete(mint);
      if (tx.type === "SWAP") unsupported++;
      continue;
    }
    if (!asset) continue;
    const [mint, quantity] = asset;
    const inventory = lots.get(mint) ?? [];
    if (quantity > 0) {
      inventory.push({ quantity, cost: -cash });
      lots.set(mint, inventory);
      results.push({ timestamp: tx.timestamp, pnl: 0, volume: -cash, matched: 0, sold: 0 });
      continue;
    }
    let remaining = -quantity;
    let basis = 0;
    while (remaining > 1e-12 && inventory.length) {
      const lot = inventory[0];
      if (!lot) break;
      const take = Math.min(remaining, lot.quantity);
      const cost = (lot.cost * take) / lot.quantity;
      basis += cost;
      lot.cost -= cost;
      lot.quantity -= take;
      remaining -= take;
      if (lot.quantity < 1e-12) inventory.shift();
    }
    lots.set(mint, inventory);
    const matched = -quantity - remaining;
    results.push({
      timestamp: tx.timestamp,
      pnl: matched > 0 ? (cash * matched) / -quantity - basis : 0,
      volume: cash,
      matched,
      sold: -quantity,
    });
  }
  return Object.fromEntries(
    Object.entries(WINDOWS).map(([window, seconds]) => {
      const recent = results.filter((r) => r.timestamp >= now / 1000 - seconds);
      const sells = recent.filter((r) => r.sold > 0);
      const covered = sells.filter((r) => Math.abs(r.matched - r.sold) < 1e-9);
      const hasBasis = sells.some((r) => r.matched > 0);
      return [
        window,
        {
          pnlUsd: hasBasis ? recent.reduce((s, r) => s + r.pnl, 0) : null,
          volumeUsd: recent.reduce((s, r) => s + r.volume, 0),
          trades: recent.length,
          coveragePct: sells.length ? Math.round((covered.length / sells.length) * 100) : null,
          status: hasBasis ? "partial" : "insufficient_history",
          unsupportedSwaps: unsupported,
          note: "Gross realized P&L from observed USDC swaps; network fees, other quote assets and unknown cost basis are excluded.",
        },
      ];
    }),
  );
}

export type LiveFill = {
  id: string;
  venue: string;
  instrumentKey: string;
  side: string;
  quantity: number;
  priceUsd: number;
  signature: string | null;
  occurredAt: string;
};
export function liveFillPerformance(fills: LiveFill[], now = Date.now()) {
  const unique = [
    ...new Map(
      fills.map((f) => [
        f.signature ? `${f.venue}:${f.signature}:${f.instrumentKey}:${f.side}` : f.id,
        f,
      ]),
    ).values(),
  ].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const inventory = new Map<string, Array<{ quantity: number; price: number }>>();
  const results: Array<{ time: number; pnl: number; matched: boolean; volume: number }> = [];
  for (const fill of unique) {
    const lots = inventory.get(fill.instrumentKey) ?? [];
    const direction = fill.side === "buy" ? 1 : -1;
    let remaining = fill.quantity;
    let pnl = 0;
    let matched = false;
    while (remaining > 1e-12 && lots[0] && Math.sign(lots[0].quantity) !== direction) {
      const lot = lots[0];
      const quantity = Math.min(remaining, Math.abs(lot.quantity));
      pnl += (fill.priceUsd - lot.price) * quantity * Math.sign(lot.quantity);
      matched = true;
      remaining -= quantity;
      lot.quantity += quantity * direction;
      if (Math.abs(lot.quantity) < 1e-12) lots.shift();
    }
    // Unmatched spot sells do not establish a short position or invented cost basis.
    if (remaining > 1e-12 && (direction > 0 || fill.venue === "hyperliquid"))
      lots.push({ quantity: remaining * direction, price: fill.priceUsd });
    inventory.set(fill.instrumentKey, lots);
    results.push({
      time: Date.parse(fill.occurredAt),
      pnl,
      matched,
      volume: fill.quantity * fill.priceUsd,
    });
  }
  return Object.fromEntries(
    Object.entries(WINDOWS).map(([window, seconds]) => {
      const recent = results.filter((r) => r.time >= now - seconds * 1000);
      return [
        window,
        {
          pnlUsd: recent.some((r) => r.matched) ? recent.reduce((sum, r) => sum + r.pnl, 0) : null,
          volumeUsd: recent.reduce((sum, r) => sum + r.volume, 0),
          trades: recent.length,
          coveragePct: null,
          status: "partial",
        },
      ];
    }),
  );
}

export class WalletLeaderboardService {
  constructor(
    private readonly db: string,
    private readonly apiKey?: string,
    private readonly hyperliquidUrl = "https://api.hyperliquid.xyz",
  ) {}
  async track(address: string) {
    await trackWallet(this.db, address);
  }
  private refreshing = new Set<string>();
  private async refresh(address: string) {
    if (this.refreshing.has(address) || (!address.startsWith("0x") && !this.apiKey)) return;
    this.refreshing.add(address);
    try {
      if (address.startsWith("0x")) {
        await this.refreshEvm(address);
        return;
      }
      const transactions: WalletTransaction[] = [];
      let before: string | undefined;
      // Include transfers as well as swaps so deposits do not manufacture cost basis.
      for (let page = 0; page < 5; page++) {
        const url = new URL(`https://api.helius.xyz/v0/addresses/${address}/transactions`);
        url.searchParams.set("api-key", this.apiKey ?? "");
        url.searchParams.set("limit", "100");
        url.searchParams.set("token-accounts", "balanceChanged");
        url.searchParams.set("commitment", "finalized");
        if (before) url.searchParams.set("before-signature", before);
        const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
        if (!response.ok) throw new Error("Wallet history unavailable.");
        const batch = History.parse(await response.json());
        transactions.push(...batch);
        if (batch.length < 100) break;
        before = batch.at(-1)?.signature;
      }
      await saveWalletPerformance(this.db, address, {
        ...walletPerformance(address, transactions),
        history: transactions,
      });
    } catch {
      // Rotate failed providers through the queue so one address cannot starve other wallets.
      await saveWalletPerformance(this.db, address, null);
    } finally {
      this.refreshing.delete(address);
    }
  }
  private async refreshEvm(address: string) {
    const response = await fetch(`${this.hyperliquidUrl}/info`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "userFills", user: address, aggregateByTime: false }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Hyperliquid fills unavailable.");
    const fills = z
      .array(
        z.object({
          tid: z.number(),
          time: z.number(),
          closedPnl: z.coerce.number().finite(),
          px: z.coerce.number().finite().nonnegative(),
          sz: z.coerce.number().finite().nonnegative(),
        }),
      )
      .parse(await response.json());
    const unique = [...new Map(fills.map((f) => [f.tid, f])).values()];
    await saveWalletPerformance(
      this.db,
      address,
      Object.fromEntries(
        Object.entries(WINDOWS).map(([window, seconds]) => {
          const recent = unique.filter((f) => f.time >= Date.now() - seconds * 1000);
          return [
            window,
            {
              pnlUsd: recent.length ? recent.reduce((s, f) => s + f.closedPnl, 0) : null,
              volumeUsd: recent.reduce((s, f) => s + f.px * f.sz, 0),
              trades: recent.length,
              coveragePct: null,
              status: recent.length ? "reported_partial" : "insufficient_history",
            },
          ];
        }),
      ),
    );
  }
  async refreshTracked(limit = 20) {
    const wallets = await listTrackedWallets(this.db);
    const stale = wallets.filter(
      (w) =>
        (String(w.address).startsWith("0x") || Boolean(this.apiKey)) &&
        (!w.evaluatedAt || Date.now() - new Date(w.evaluatedAt).getTime() > 300_000),
    );
    const batch = stale.slice(0, limit);
    await Promise.allSettled(batch.map((w) => this.refresh(String(w.address))));
    return { refreshed: batch.length };
  }
  async board(window: keyof typeof WINDOWS, query = "") {
    await this.refreshTracked(4);
    const [wallets, records] = await Promise.all([
      listTrackedWallets(this.db),
      listLeaderboardLiveFills(this.db),
    ]);
    const local = new Map<string, { name: string; chain: string; fills: LiveFill[] }>();
    for (const record of records) {
      const wallet = record.wallet == null ? null : String(record.wallet);
      const hash = createHash("sha256")
        .update(`${record.tenantId}:${record.subject}`)
        .digest("hex")
        .slice(0, 12);
      const key = wallet ?? `sisera:${hash}:${record.venue}`;
      const group = local.get(key) ?? {
        name: wallet ?? `Trader ${hash.slice(0, 8)}`,
        chain: wallet ? "solana" : String(record.venue),
        fills: [],
      };
      group.fills.push({
        id: String(record.id),
        venue: String(record.venue),
        instrumentKey: String(record.instrumentKey),
        side: String(record.side),
        quantity: Number(record.quantity),
        priceUsd: Number(record.priceUsd),
        signature: record.signature == null ? null : String(record.signature),
        occurredAt: new Date(record.occurredAt).toISOString(),
      });
      local.set(key, group);
    }
    const entries = new Map(wallets.map((w) => [String(w.address), w]));
    const addresses = new Set([...entries.keys(), ...local.keys()]);
    const rows = [...addresses]
      .map((address) => {
        const w = entries.get(address);
        const group = local.get(address);
        const raw = w?.performance as Record<string, unknown> | null;
        const fresh = w?.evaluatedAt && Date.now() - new Date(w.evaluatedAt).getTime() <= 300_000;
        type Metrics = {
          pnlUsd: number | null;
          volumeUsd: number;
          trades: number;
          coveragePct: number | null;
          status: string;
        };
        let p = fresh ? (raw?.[window] as Metrics | undefined) : undefined;
        if (group) {
          if (group.chain === "solana") {
            const history = fresh ? History.safeParse(raw?.history) : null;
            const transactions: WalletTransaction[] = group.fills.map((f) => ({
              signature: f.signature ?? `sisera:${f.id}`,
              timestamp: Date.parse(f.occurredAt) / 1000,
              type: "SWAP",
              transactionError: null,
              tokenTransfers: [
                {
                  mint: f.instrumentKey,
                  tokenAmount: f.quantity,
                  fromUserAccount: f.side === "sell" ? address : "venue",
                  toUserAccount: f.side === "buy" ? address : "venue",
                },
                {
                  mint: USDC_MINT,
                  tokenAmount: f.quantity * f.priceUsd,
                  fromUserAccount: f.side === "buy" ? address : "venue",
                  toUserAccount: f.side === "sell" ? address : "venue",
                },
              ],
            }));
            p = walletPerformance(address, [
              ...transactions,
              ...(history?.success ? history.data : []),
            ])[window];
          } else p = liveFillPerformance(group.fills)[window];
        }
        return {
          address,
          name: group?.name ?? address,
          chain: group?.chain ?? String(w?.chain),
          identity: group ? "Sisera trader" : "Tracked wallet",
          pnlUsd: p?.pnlUsd ?? null,
          volumeUsd: p?.volumeUsd ?? null,
          trades: p?.trades ?? null,
          coveragePct: p?.coveragePct ?? null,
          status: p?.status ?? "unavailable",
          observedAt: group
            ? (group.fills[0]?.occurredAt ?? null)
            : w?.evaluatedAt
              ? new Date(w.evaluatedAt).toISOString()
              : null,
        };
      })
      .sort(
        (a, b) =>
          (b.pnlUsd ?? Number.NEGATIVE_INFINITY) - (a.pnlUsd ?? Number.NEGATIVE_INFINITY) ||
          a.address.localeCompare(b.address),
      );
    let rank = 0;
    return {
      window,
      totalTracked: rows.length,
      rows: rows
        .map((r) => ({ ...r, rank: r.pnlUsd == null ? null : ++rank }))
        .filter((r) => `${r.address} ${r.name}`.toLowerCase().includes(query.toLowerCase())),
      methodology:
        "Live trades only: Sisera confirmed fills plus tracked wallet history. Realized gross P&L; partial coverage, excluding funding, fees and unknown cost basis.",
    };
  }
}
