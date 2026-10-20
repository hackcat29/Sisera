import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { HeliusClient } from "./helius.js";

export const SISERA_MINT = "4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5";
export const SISERA_PRIMARY_POOL = "6fPLnuqvzkpRD866RjCjeFWBxRMbnhKdoMjPjTcxdqHE";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const SISERA_GENESIS_SUPPLY = 1_000_000_000;
export const SISERA_CIRCULATING_SUPPLY = 945_060_456.354228;
export const SISERA_BURNED_SUPPLY = 54_939_543.645772;
export const SISERA_BURNED_PCT = 5.49;

const HeliusTokenTransfer = z.object({
  mint: z.string(),
  tokenAmount: z.number(),
  fromUserAccount: z.string().nullable().optional(),
  toUserAccount: z.string().nullable().optional(),
});

const HeliusNativeTransfer = z.object({
  fromUserAccount: z.string().nullable().optional(),
  toUserAccount: z.string().nullable().optional(),
  amount: z.number(),
});

export const HeliusEnhancedTransaction = z.object({
  signature: z.string(),
  timestamp: z.number().optional(),
  type: z.string().optional(),
  source: z.string().optional(),
  feePayer: z.string().optional(),
  transactionError: z.unknown().optional(),
  tokenTransfers: z.array(HeliusTokenTransfer).default([]),
  nativeTransfers: z.array(HeliusNativeTransfer).default([]),
});

export type HeliusEnhancedTx = z.infer<typeof HeliusEnhancedTransaction>;

export interface SiseraBuyEvent {
  signature: string;
  timestamp: number;
  buyer: string;
  tokenAmount: number;
  solSpent: number;
  usdcSpent: number;
  source: string;
}

export interface SiseraMarketSnapshot {
  priceUsd: number;
  priceNativeSol: number;
  solPriceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange24hPct: number | null;
  pairAddresses: string[];
}

export interface SiseraBuyerHolderInfo {
  totalBalance: number;
  isNewHolder: boolean;
  positionIncreasePct: number | null;
  supplyPct: number;
}

const DexScreenerResponse = z.object({
  pairs: z
    .array(
      z.object({
        chainId: z.string().optional(),
        dexId: z.string().optional(),
        pairAddress: z.string(),
        priceUsd: z.coerce.number().nonnegative().optional(),
        priceNative: z.coerce.number().nonnegative().optional(),
        quoteToken: z.object({ address: z.string().optional() }).optional(),
        fdv: z.coerce.number().nonnegative().optional(),
        marketCap: z.coerce.number().nonnegative().optional(),
        liquidity: z
          .object({
            usd: z.coerce.number().nonnegative().optional(),
          })
          .optional(),
        volume: z
          .object({
            h24: z.coerce.number().nonnegative().optional(),
          })
          .optional(),
        priceChange: z
          .object({
            h24: z.coerce.number().optional(),
          })
          .optional(),
      }),
    )
    .nullable()
    .optional(),
});

/**
 * Extracts a verified $SISERA buy from a Helius Enhanced Transaction.
 * Filters out sells, failed transactions, and non-swap wallet transfers.
 */
export function extractSiseraBuy(
  tx: HeliusEnhancedTx,
  mint: string = SISERA_MINT,
  knownPools: ReadonlySet<string> = new Set([SISERA_PRIMARY_POOL]),
): SiseraBuyEvent | null {
  if (tx.transactionError || !tx.feePayer) return null;

  const siseraDeltas = new Map<string, number>();
  for (const transfer of tx.tokenTransfers) {
    if (
      transfer.mint !== mint ||
      !Number.isFinite(transfer.tokenAmount) ||
      transfer.tokenAmount <= 0
    ) {
      continue;
    }
    if (transfer.fromUserAccount) {
      siseraDeltas.set(
        transfer.fromUserAccount,
        (siseraDeltas.get(transfer.fromUserAccount) ?? 0) - transfer.tokenAmount,
      );
    }
    if (transfer.toUserAccount) {
      siseraDeltas.set(
        transfer.toUserAccount,
        (siseraDeltas.get(transfer.toUserAccount) ?? 0) + transfer.tokenAmount,
      );
    }
  }

  // If any known liquidity pool had a net positive SISERA delta, tokens were sold into the pool.
  for (const pool of knownPools) {
    if ((siseraDeltas.get(pool) ?? 0) > 0) return null;
  }

  // If the transaction feePayer lost SISERA, the signer was selling.
  if ((siseraDeltas.get(tx.feePayer) ?? 0) < 0) return null;

  let poolSentSisera = false;
  for (const pool of knownPools) {
    if ((siseraDeltas.get(pool) ?? 0) < 0) {
      poolSentSisera = true;
      break;
    }
  }

  let buyer: string | null = null;
  const feePayerDelta = siseraDeltas.get(tx.feePayer) ?? 0;
  if (feePayerDelta > 0 && !knownPools.has(tx.feePayer)) {
    buyer = tx.feePayer;
  } else if (poolSentSisera) {
    // Support gasless/relayed transactions (e.g. Jupiter Ultra, OKX Router) where feePayer is a relayer.
    let bestDelta = 0;
    for (const [account, delta] of siseraDeltas.entries()) {
      if (!knownPools.has(account) && delta > bestDelta) {
        bestDelta = delta;
        buyer = account;
      }
    }
  }

  if (!buyer) return null;
  const tokenAmount = siseraDeltas.get(buyer) ?? 0;
  if (tokenAmount <= 0) return null;

  let solSpent = 0;
  let usdcSpent = 0;
  let poolSolIn = 0;

  for (const transfer of tx.tokenTransfers) {
    if (!Number.isFinite(transfer.tokenAmount) || transfer.tokenAmount <= 0) continue;
    const fromBuyer = transfer.fromUserAccount === buyer;
    const toBuyer = transfer.toUserAccount === buyer;

    if (transfer.mint === WSOL_MINT) {
      if (fromBuyer && !toBuyer) solSpent += transfer.tokenAmount;
      else if (!fromBuyer && toBuyer) solSpent -= transfer.tokenAmount;

      if (
        transfer.toUserAccount &&
        knownPools.has(transfer.toUserAccount) &&
        (!transfer.fromUserAccount || !knownPools.has(transfer.fromUserAccount))
      ) {
        poolSolIn += transfer.tokenAmount;
      }
    } else if (transfer.mint === USDC_MINT || transfer.mint === USDT_MINT) {
      if (fromBuyer && !toBuyer) usdcSpent += transfer.tokenAmount;
      else if (!fromBuyer && toBuyer) usdcSpent -= transfer.tokenAmount;
    }
  }

  // In multi-hop swaps (e.g. USDC -> WSOL -> SISERA), the buyer spends USDC while the pool receives WSOL.
  if (solSpent <= 1e-6 && poolSolIn > 0) {
    solSpent = poolSolIn;
  }

  // Fallback for direct native SOL transfers (e.g. bonding curve swaps without WSOL token transfers).
  if (solSpent <= 1e-6 && usdcSpent <= 1e-4 && tx.nativeTransfers.length > 0) {
    let lamportsOut = 0;
    for (const native of tx.nativeTransfers) {
      if (native.fromUserAccount === buyer && native.toUserAccount !== buyer) {
        lamportsOut += native.amount;
      } else if (native.toUserAccount === buyer && native.fromUserAccount !== buyer) {
        lamportsOut -= native.amount;
      }
    }
    if (lamportsOut > 1_000_000) {
      solSpent = lamportsOut / 1e9;
    }
  }

  solSpent = Math.max(0, solSpent);
  usdcSpent = Math.max(0, usdcSpent);
  if (solSpent <= 0.0001 && usdcSpent <= 0.01) return null;

  return {
    signature: tx.signature,
    timestamp: tx.timestamp ?? Math.floor(Date.now() / 1000),
    buyer,
    tokenAmount,
    solSpent,
    usdcSpent,
    source: tx.source && tx.source !== "UNKNOWN" ? tx.source : "PUMPSWAP",
  };
}

function formatNumber(value: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: maxFractionDigits === 0 ? 0 : Math.min(2, maxFractionDigits),
  }).format(value);
}

function formatPriceUsd(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "$0.00";
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.01) return `$${price.toFixed(5)}`;
  return `$${price.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function shortenAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatVenueName(source: string): string {
  const normalized = source.toUpperCase();
  if (normalized.includes("PUMP")) return "PumpSwap";
  if (normalized.includes("JUPITER")) return "Jupiter";
  if (normalized.includes("OKX")) return "OKX DEX";
  if (normalized.includes("RAYDIUM")) return "Raydium";
  if (normalized.includes("METEORA")) return "Meteora";
  if (normalized.includes("DFLOW")) return "DFlow";
  return "Solana DEX";
}

export function computeBuyUsdValue(buy: SiseraBuyEvent, snapshot: SiseraMarketSnapshot): number {
  if (buy.usdcSpent > 0) return buy.usdcSpent;
  if (buy.solSpent > 0 && snapshot.solPriceUsd > 0) return buy.solSpent * snapshot.solPriceUsd;
  if (buy.tokenAmount > 0 && snapshot.priceUsd > 0) return buy.tokenAmount * snapshot.priceUsd;
  return 0;
}

export type SiseraAlertMedia = "buy" | "big-buy" | "mega-buy" | "whale" | "stats";

/**
 * Maps a buy's USD size to its tier; `media` names the card in stickers/alerts/.
 */
export function siseraBuyTier(usdValue: number): {
  media: SiseraAlertMedia;
  header: string;
  orb: string;
} {
  if (usdValue >= 2_000)
    return { media: "whale", header: "🐋 <b>$SISERA WHALE ALERT!</b>", orb: "🐋" };
  if (usdValue >= 500)
    return { media: "mega-buy", header: "🚀 <b>MEGA $SISERA BUY!</b>", orb: "🚀" };
  if (usdValue >= 100) return { media: "big-buy", header: "⚡ <b>BIG $SISERA BUY!</b>", orb: "🟢" };
  return { media: "buy", header: "🟢 <b>NEW $SISERA BUY!</b>", orb: "🟢" };
}

/**
 * Formats the HTML caption/message for a $SISERA buy alert in Telegram.
 */
export function formatSiseraBuyMessage(
  buy: SiseraBuyEvent,
  snapshot: SiseraMarketSnapshot,
  holder?: SiseraBuyerHolderInfo | null,
): string {
  const usdValue = computeBuyUsdValue(buy, snapshot);

  const tier = siseraBuyTier(usdValue);

  // 1 orb per $10 spent (minimum 3 orbs, maximum 36 orbs)
  const orbCount = Math.max(3, Math.min(36, Math.ceil(usdValue / 10)));
  const orbBar = tier.orb.repeat(orbCount);

  const spentParts: string[] = [];
  if (buy.solSpent > 0) {
    spentParts.push(`<b>${buy.solSpent.toFixed(4)} SOL</b>`);
  }
  if (buy.usdcSpent > 0) {
    spentParts.push(`<b>${formatNumber(buy.usdcSpent, 2)} USDC</b>`);
  }
  const spentDisplay =
    usdValue > 0 && buy.usdcSpent === 0
      ? `${spentParts.join(" + ")} ($${formatNumber(usdValue, 2)})`
      : spentParts.join(" / ");

  const marketCapUsd =
    snapshot.marketCapUsd > 0
      ? snapshot.marketCapUsd
      : snapshot.priceUsd * SISERA_CIRCULATING_SUPPLY;

  let holderLine = `👤 <b>Buyer:</b> <a href="https://solscan.io/account/${buy.buyer}">${shortenAddress(buy.buyer)}</a>`;
  if (holder) {
    if (holder.isNewHolder) {
      holderLine += " | 🌱 <b>New Holder!</b>";
    } else if (holder.positionIncreasePct !== null && holder.positionIncreasePct > 0) {
      const pctLabel =
        holder.positionIncreasePct > 999 ? "+999%+" : `+${holder.positionIncreasePct.toFixed(1)}%`;
      holderLine += ` | 💎 <b>Position ${pctLabel}</b>`;
    }
    if (holder.supplyPct >= 0.01) {
      holderLine += ` (${holder.supplyPct.toFixed(2)}% Supply)`;
    }
  }

  const venue = formatVenueName(buy.source);
  const lines = [
    tier.header,
    orbBar,
    "",
    `💵 <b>Spent:</b> ${spentDisplay}`,
    `🪙 <b>Received:</b> <b>${formatNumber(buy.tokenAmount, 0)} SISERA</b>`,
    `🏷️ <b>Price:</b> ${formatPriceUsd(snapshot.priceUsd)}`,
    `📊 <b>Market Cap:</b> $${formatNumber(marketCapUsd, 0)} | 💧 <b>Liq:</b> $${formatNumber(snapshot.liquidityUsd, 0)}`,
    `🔥 <b>Burned:</b> ${formatNumber(SISERA_BURNED_SUPPLY, 0)} SISERA (${SISERA_BURNED_PCT}%)`,
    "",
    holderLine,
    `⚡ <b>Venue:</b> ${venue} | 🔗 <a href="https://solscan.io/tx/${buy.signature}">Solscan Tx</a>`,
  ];

  return lines.join("\n");
}

/**
 * Formats a live /price or /stats status card for the Telegram group.
 */
export function formatSiseraStatsMessage(
  snapshot: SiseraMarketSnapshot,
  mint = SISERA_MINT,
): string {
  const marketCapUsd =
    snapshot.marketCapUsd > 0
      ? snapshot.marketCapUsd
      : snapshot.priceUsd * SISERA_CIRCULATING_SUPPLY;
  const changeTag =
    snapshot.priceChange24hPct !== null
      ? ` (${snapshot.priceChange24hPct >= 0 ? "+" : ""}${snapshot.priceChange24hPct.toFixed(2)}% 24h)`
      : "";

  return [
    "🏛️ <b>SISERA ($SISERA) — LIVE MARKET SNAPSHOT</b>",
    "",
    `🏷️ <b>Price:</b> ${formatPriceUsd(snapshot.priceUsd)}${changeTag}`,
    `📊 <b>Market Cap:</b> $${formatNumber(marketCapUsd, 0)}`,
    `💧 <b>Liquidity:</b> $${formatNumber(snapshot.liquidityUsd, 0)}`,
    `📈 <b>24h Volume:</b> $${formatNumber(snapshot.volume24hUsd, 0)}`,
    `🪙 <b>Circulating Supply:</b> ${formatNumber(SISERA_CIRCULATING_SUPPLY, 0)} SISERA (100% Unlocked)`,
    `🔥 <b>Burned Supply:</b> ${formatNumber(SISERA_BURNED_SUPPLY, 0)} SISERA (${SISERA_BURNED_PCT}% Burned)`,
    "",
    "📋 <b>Contract Address (Solana):</b>",
    `<code>${mint}</code>`,
  ].join("\n");
}

export function buildBuyBotInlineKeyboard(
  signature?: string,
  mint: string = SISERA_MINT,
  terminalUrl = "https://sisera.xyz",
) {
  const topRow = [
    {
      text: "📊 DEXScreener",
      url: `https://dexscreener.com/solana/${mint}`,
    },
    {
      text: "⚡ Buy on Pump.fun",
      url: `https://pump.fun/coin/${mint}`,
    },
  ];
  const secondRow = [
    {
      text: "🦅 Buy on FOMO",
      url: `https://fomo.family/token/${mint}`,
    },
    {
      text: "💻 Sisera Terminal",
      url: terminalUrl,
    },
  ];
  const rows = [topRow, secondRow];
  if (signature) {
    rows.push([
      {
        text: "🔍 View Transaction on Solscan",
        url: `https://solscan.io/tx/${signature}`,
      },
    ]);
  }
  return { inline_keyboard: rows };
}

/**
 * Formats one combined message for buys that queued up faster than Telegram lets the bot post.
 */
export function formatSiseraBuyBacklogMessage(
  buys: Array<{ buy: SiseraBuyEvent; usdValue: number }>,
): string {
  const totalUsd = buys.reduce((sum, item) => sum + item.usdValue, 0);
  const totalTokens = buys.reduce((sum, item) => sum + item.buy.tokenAmount, 0);
  const largest = [...buys].sort((a, b) => b.usdValue - a.usdValue).slice(0, 10);
  const lines = [
    `🟢 <b>+${buys.length} $SISERA BUYS</b>`,
    "",
    `💵 <b>Total:</b> $${formatNumber(totalUsd, 2)} for ${formatNumber(totalTokens, 0)} SISERA`,
    "",
    ...largest.map(
      ({ buy, usdValue }) =>
        `• $${formatNumber(usdValue, 2)} by <a href="https://solscan.io/account/${buy.buyer}">${shortenAddress(buy.buyer)}</a> | <a href="https://solscan.io/tx/${buy.signature}">Tx</a>`,
    ),
  ];
  if (buys.length > largest.length) lines.push(`…and ${buys.length - largest.length} smaller buys`);
  return lines.join("\n");
}

type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; url: string }>> };

interface QueuedTelegramMessage {
  html: string;
  keyboard?: InlineKeyboard;
  /** Alert card to attach; plain text when null. */
  media: SiseraAlertMedia | null;
  chatId: string;
  /** Set for buy alerts so a backlog of them can be merged into one message. */
  buy?: { buy: SiseraBuyEvent; usdValue: number };
}

/** Telegram answered 429; `retryAfterMs` is how long it asked the bot to wait. */
class TelegramRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Telegram rate limited the bot for ${retryAfterMs}ms`);
  }
}

async function telegramRateLimit(response: Response): Promise<TelegramRateLimitError | null> {
  if (response.status !== 429) return null;
  const payload = (await response.json().catch(() => ({}))) as {
    parameters?: { retry_after?: number };
  };
  return new TelegramRateLimitError(Math.max(1, payload.parameters?.retry_after ?? 5) * 1_000);
}

const HELIUS_PAGE_SIZE = 100;
const HELIUS_MAX_PAGES = 5;
const BACKLOG_THRESHOLD = 5;
const MAX_SEND_ATTEMPTS = 5;
const SOL_PRICE_TTL_MS = 60_000;
// The group's Rose bot already answers "ca", so the buybot leaves that to it.
const COMMAND_LONG_POLL_SECONDS = 25;
const BOT_COMMANDS = new Set(["/price", "/stats", "/burn"]);

const JupiterPrice = z.record(z.string(), z.object({ usdPrice: z.number() }).nullable());

export interface SiseraTelegramBuyBotOptions {
  botToken: string;
  chatId: string;
  heliusApiKey: string;
  mint?: string;
  minUsd?: number;
  pollIntervalMs?: number;
  terminalUrl?: string;
  /** Directory holding the tier cards rendered by scripts/render-stickers.mjs. */
  mediaDir?: string;
  enableCommands?: boolean;
  /** Used for the SOL/USD price that values SOL-denominated buys. */
  jupiterApiKey?: string | undefined;
  /** Gap between messages to the same group; Telegram allows about 20 per minute. */
  minSendIntervalMs?: number;
  /** How long each group command stays silent after it was answered. */
  commandCooldownMs?: number;
  heliusClient?: HeliusClient;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  logger?: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
}

export class SiseraTelegramBuyBot {
  private readonly mint: string;
  private readonly minUsd: number;
  private readonly pollIntervalMs: number;
  private readonly terminalUrl: string;
  private readonly mediaDir: string;
  private readonly enableCommands: boolean;
  private readonly minSendIntervalMs: number;
  private readonly commandCooldownMs: number;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly knownPools = new Set<string>([SISERA_PRIMARY_POOL]);
  private readonly seenSignatures = new Set<string>();
  private readonly cachedPhotoFileIds = new Map<SiseraAlertMedia, string>();
  private readonly sendQueue: QueuedTelegramMessage[] = [];
  private readonly commandLastAnsweredAt = new Map<string, number>();
  private cachedSnapshot: { data: SiseraMarketSnapshot; fetchedAt: number } | null = null;
  private cachedSolPrice: { usd: number; fetchedAt: number } | null = null;
  private draining: Promise<void> | null = null;
  private lastSentAt = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private commandAbort: AbortController | null = null;
  private lastUpdateId = 0;
  private initialized = false;
  private pollingInFlight = false;

  constructor(private readonly options: SiseraTelegramBuyBotOptions) {
    this.mint = options.mint ?? SISERA_MINT;
    this.minUsd = options.minUsd ?? 2;
    this.pollIntervalMs = options.pollIntervalMs ?? 10_000;
    this.terminalUrl = options.terminalUrl ?? "https://sisera.xyz";
    this.mediaDir = options.mediaDir ?? resolve(process.cwd(), "stickers", "alerts");
    this.enableCommands = options.enableCommands ?? true;
    this.minSendIntervalMs = options.minSendIntervalMs ?? 3_100;
    this.commandCooldownMs = options.commandCooldownMs ?? 30_000;
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  }

  /**
   * Fetches and caches live market price, SOL price, liquidity, and active pair addresses from DEXScreener.
   */
  async getMarketSnapshot(forceRefresh = false): Promise<SiseraMarketSnapshot> {
    const now = Date.now();
    if (!forceRefresh && this.cachedSnapshot && now - this.cachedSnapshot.fetchedAt < 15_000) {
      return this.cachedSnapshot.data;
    }

    try {
      const response = await this.fetcher(
        `https://api.dexscreener.com/latest/dex/tokens/${this.mint}`,
        { signal: AbortSignal.timeout(6_000) },
      );
      if (!response.ok) throw new Error(`DEXScreener returned ${response.status}`);
      const parsed = DexScreenerResponse.parse(await response.json());
      const pairs = parsed.pairs ?? [];
      for (const pair of pairs) {
        if (pair.pairAddress) this.knownPools.add(pair.pairAddress);
      }
      pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      const primary = pairs[0] ?? null;
      // priceNative is quoted in the pair's quote token, so only a SOL-quoted pair yields a SOL price.
      const solPair = pairs.find(
        (pair) =>
          pair.quoteToken?.address === WSOL_MINT &&
          (pair.priceUsd ?? 0) > 0 &&
          (pair.priceNative ?? 0) > 0,
      );

      const priceUsd = primary?.priceUsd ?? 0;
      const priceNativeSol = solPair?.priceNative ?? 0;
      const solPriceUsd = await this.getSolPriceUsd(
        solPair ? (solPair.priceUsd ?? 0) / priceNativeSol : 0,
      );
      const marketCapUsd =
        primary?.marketCap ?? primary?.fdv ?? priceUsd * SISERA_CIRCULATING_SUPPLY;
      const liquidityUsd = pairs.reduce((sum, p) => sum + (p.liquidity?.usd ?? 0), 0);
      const volume24hUsd = pairs.reduce((sum, p) => sum + (p.volume?.h24 ?? 0), 0);

      const snapshot: SiseraMarketSnapshot = {
        priceUsd,
        priceNativeSol,
        solPriceUsd,
        marketCapUsd,
        liquidityUsd,
        volume24hUsd,
        priceChange24hPct: primary?.priceChange?.h24 ?? null,
        pairAddresses: [...this.knownPools],
      };
      this.cachedSnapshot = { data: snapshot, fetchedAt: now };
      return snapshot;
    } catch (error) {
      this.options.logger?.warn({ error }, "BuyBot failed to refresh DEXScreener snapshot");
      if (this.cachedSnapshot) return this.cachedSnapshot.data;
      // With no SOL price, computeBuyUsdValue values SOL buys from the token amount instead.
      return {
        priceUsd: 0,
        priceNativeSol: 0,
        solPriceUsd: await this.getSolPriceUsd(0),
        marketCapUsd: 0,
        liquidityUsd: 0,
        volume24hUsd: 0,
        priceChange24hPct: null,
        pairAddresses: [...this.knownPools],
      };
    }
  }

  /**
   * SOL/USD from Jupiter, falling back to the SOL-quoted DEXScreener pair, then the last known price.
   * Returns 0 when no source is available.
   */
  private async getSolPriceUsd(dexScreenerSolPrice: number): Promise<number> {
    const now = Date.now();
    if (this.cachedSolPrice && now - this.cachedSolPrice.fetchedAt < SOL_PRICE_TTL_MS) {
      return this.cachedSolPrice.usd;
    }
    try {
      const base = this.options.jupiterApiKey
        ? "https://api.jup.ag/price/v3"
        : "https://lite-api.jup.ag/price/v3";
      const response = await this.fetcher(`${base}?ids=${WSOL_MINT}`, {
        headers: this.options.jupiterApiKey ? { "x-api-key": this.options.jupiterApiKey } : {},
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error(`Jupiter price returned ${response.status}`);
      const usd = JupiterPrice.parse(await response.json())[WSOL_MINT]?.usdPrice ?? 0;
      if (Number.isFinite(usd) && usd > 0) {
        this.cachedSolPrice = { usd, fetchedAt: now };
        return usd;
      }
    } catch (error) {
      this.options.logger?.warn({ error }, "BuyBot failed to refresh SOL price from Jupiter");
    }
    if (Number.isFinite(dexScreenerSolPrice) && dexScreenerSolPrice > 0) {
      this.cachedSolPrice = { usd: dexScreenerSolPrice, fetchedAt: now };
      return dexScreenerSolPrice;
    }
    return this.cachedSolPrice?.usd ?? 0;
  }

  /**
   * Queries buyer's current $SISERA token balance to determine New Holder vs Position Increase.
   */
  async getBuyerHolderInfo(
    buyer: string,
    boughtAmount: number,
  ): Promise<SiseraBuyerHolderInfo | null> {
    if (!this.options.heliusClient) return null;
    try {
      const { rawBalance, decimals } = await this.options.heliusClient.getTokenBalance(
        buyer,
        this.mint,
      );
      const totalBalance = Number(rawBalance) / 10 ** decimals;
      if (!Number.isFinite(totalBalance) || totalBalance <= 0) return null;

      const previousBalance = Math.max(0, totalBalance - boughtAmount);
      const isNewHolder = previousBalance <= boughtAmount * 0.01;
      const positionIncreasePct =
        !isNewHolder && previousBalance > 0 ? (boughtAmount / previousBalance) * 100 : null;
      const supplyPct = (totalBalance / SISERA_CIRCULATING_SUPPLY) * 100;

      return {
        totalBalance,
        isNewHolder,
        positionIncreasePct,
        supplyPct,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetches enhanced transactions for $SISERA from Helius, newest first.
   * Pass `beforeSignature` to page further back in history.
   */
  async fetchRecentTransactions(
    limit = HELIUS_PAGE_SIZE,
    beforeSignature?: string,
  ): Promise<HeliusEnhancedTx[]> {
    const url = new URL(`https://api.helius.xyz/v0/addresses/${this.mint}/transactions`);
    url.searchParams.set("api-key", this.options.heliusApiKey);
    url.searchParams.set("limit", String(limit));
    if (beforeSignature) url.searchParams.set("before-signature", beforeSignature);
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      throw new Error(`Helius transactions endpoint returned ${response.status}`);
    }
    return z.array(HeliusEnhancedTransaction).parse(await response.json());
  }

  /**
   * Fetches every transaction since the last one the bot saw, paging back up to HELIUS_MAX_PAGES.
   */
  private async fetchUnseenTransactions(): Promise<HeliusEnhancedTx[]> {
    const collected: HeliusEnhancedTx[] = [];
    let before: string | undefined;
    for (let page = 0; page < HELIUS_MAX_PAGES; page++) {
      const txs = await this.fetchRecentTransactions(HELIUS_PAGE_SIZE, before);
      collected.push(...txs);
      if (txs.length < HELIUS_PAGE_SIZE || txs.some((tx) => this.seenSignatures.has(tx.signature)))
        return collected;
      before = txs.at(-1)?.signature;
    }
    this.options.logger?.warn(
      { pages: HELIUS_MAX_PAGES, transactions: collected.length },
      "BuyBot did not reach its last seen transaction; older transactions were skipped",
    );
    return collected;
  }

  /**
   * Sends a message, or a photo with caption when `media` is set, straight to Telegram.
   * Throws TelegramRateLimitError on 429 so the caller can wait and retry.
   * Group alerts should go through the send queue instead (see processTransactions).
   */
  async sendTelegramAlert(
    htmlCaption: string,
    replyMarkup: InlineKeyboard | undefined,
    media: SiseraAlertMedia | null,
    targetChatId: string = this.options.chatId,
  ): Promise<void> {
    const baseUrl = `https://api.telegram.org/bot${this.options.botToken}`;
    const mediaPath = media ? join(this.mediaDir, `${media}.png`) : null;
    const cachedFileId = media ? this.cachedPhotoFileIds.get(media) : undefined;

    // Try sending with the tier's Sisera alert card first
    if (media && mediaPath && (cachedFileId || existsSync(mediaPath))) {
      let response: Response | null = null;
      try {
        if (cachedFileId) {
          response = await this.fetcher(`${baseUrl}/sendPhoto`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: targetChatId,
              photo: cachedFileId,
              caption: htmlCaption,
              parse_mode: "HTML",
              reply_markup: replyMarkup,
            }),
            signal: AbortSignal.timeout(8_000),
          });
        } else {
          const bytes = await readFile(mediaPath);
          const form = new FormData();
          form.set("chat_id", targetChatId);
          form.set("caption", htmlCaption);
          form.set("parse_mode", "HTML");
          if (replyMarkup) form.set("reply_markup", JSON.stringify(replyMarkup));
          form.set("photo", new Blob([bytes], { type: "image/png" }), `${media}.png`);
          response = await this.fetcher(`${baseUrl}/sendPhoto`, {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(10_000),
          });
        }
      } catch (error) {
        this.options.logger?.warn(
          { error },
          "BuyBot sendPhoto failed, falling back to sendMessage",
        );
      }

      if (response) {
        const rateLimited = await telegramRateLimit(response);
        if (rateLimited) throw rateLimited;
        if (response.ok) {
          const payload = (await response.json()) as {
            ok?: boolean;
            result?: { photo?: Array<{ file_id?: string }> };
          };
          const fileId = payload.result?.photo?.at(-1)?.file_id;
          if (fileId) this.cachedPhotoFileIds.set(media, fileId);
          return;
        }
        // Reset cached file_id if Telegram rejected it
        this.cachedPhotoFileIds.delete(media);
      }
    }

    const fallbackResponse = await this.fetcher(`${baseUrl}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: htmlCaption,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    const rateLimited = await telegramRateLimit(fallbackResponse);
    if (rateLimited) throw rateLimited;
    if (!fallbackResponse.ok) {
      const errorText = await fallbackResponse.text().catch(() => "");
      throw new Error(`Telegram sendMessage failed (${fallbackResponse.status}): ${errorText}`);
    }
  }

  /**
   * Evaluates a batch of Helius transactions, deduplicates by signature, and queues qualifying buys.
   * Returns the number of buy alerts queued; call flushAlerts() to wait until they are posted.
   */
  async processTransactions(transactions: HeliusEnhancedTx[]): Promise<number> {
    const unseen = transactions.filter((tx) => !this.seenSignatures.has(tx.signature));
    for (const tx of unseen) {
      this.seenSignatures.add(tx.signature);
    }
    if (this.seenSignatures.size > 5_000) {
      const oldest = [...this.seenSignatures].slice(0, 1_000);
      for (const sig of oldest) this.seenSignatures.delete(sig);
    }

    if (unseen.length === 0) return 0;
    const snapshot = await this.getMarketSnapshot();

    // Process from oldest to newest so group alerts appear in chronological order
    const chronological = [...unseen].reverse();
    const alerts: QueuedTelegramMessage[] = [];

    for (const tx of chronological) {
      const buy = extractSiseraBuy(tx, this.mint, this.knownPools);
      if (!buy) continue;

      const usdValue = computeBuyUsdValue(buy, snapshot);
      if (usdValue < this.minUsd) continue;

      const holderInfo = await this.getBuyerHolderInfo(buy.buyer, buy.tokenAmount);
      alerts.push({
        html: formatSiseraBuyMessage(buy, snapshot, holderInfo),
        keyboard: buildBuyBotInlineKeyboard(buy.signature, this.mint, this.terminalUrl),
        media: siseraBuyTier(usdValue).media,
        chatId: this.options.chatId,
        buy: { buy, usdValue },
      });
    }

    // Queue the whole batch at once so a burst from one poll is combined rather than drip-fed.
    this.enqueue(...alerts);
    return alerts.length;
  }

  /**
   * Resolves once every queued Telegram message has been posted or given up on.
   */
  async flushAlerts(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private enqueue(...messages: QueuedTelegramMessage[]): void {
    if (messages.length === 0) return;
    this.sendQueue.push(...messages);
    this.draining ??= this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    try {
      while (this.sendQueue.length > 0) {
        const pendingBuys = this.sendQueue.filter((message) => message.buy).length;
        const next =
          pendingBuys > BACKLOG_THRESHOLD
            ? this.collapseBuyBacklog()
            : (this.sendQueue.shift() as QueuedTelegramMessage);
        await this.deliver(next);
      }
    } finally {
      this.draining = null;
    }
  }

  /**
   * Replaces every queued buy alert with one combined message, keeping commands in the queue.
   */
  private collapseBuyBacklog(): QueuedTelegramMessage {
    const buys: Array<{ buy: SiseraBuyEvent; usdValue: number }> = [];
    for (let index = this.sendQueue.length - 1; index >= 0; index--) {
      const queued = this.sendQueue[index]?.buy;
      if (!queued) continue;
      buys.unshift(queued);
      this.sendQueue.splice(index, 1);
    }
    this.options.logger?.info({ buys: buys.length }, "Combining queued $SISERA buy alerts");
    return {
      html: formatSiseraBuyBacklogMessage(buys),
      keyboard: buildBuyBotInlineKeyboard(undefined, this.mint, this.terminalUrl),
      media: null,
      chatId: this.options.chatId,
    };
  }

  /**
   * Posts one message, spacing sends to stay under Telegram's group limit and waiting out 429s.
   * Other failures drop only this message, so one bad send never stalls the rest of the queue.
   */
  private async deliver(message: QueuedTelegramMessage): Promise<void> {
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      const wait = this.lastSentAt + this.minSendIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      try {
        await this.sendTelegramAlert(message.html, message.keyboard, message.media, message.chatId);
        this.lastSentAt = Date.now();
        if (message.buy) {
          this.options.logger?.info(
            {
              signature: message.buy.buy.signature,
              buyer: message.buy.buy.buyer,
              tokenAmount: message.buy.buy.tokenAmount,
              usdValue: Number(message.buy.usdValue.toFixed(2)),
            },
            "Sent Telegram $SISERA buy alert",
          );
        }
        return;
      } catch (error) {
        this.lastSentAt = Date.now();
        if (error instanceof TelegramRateLimitError && attempt < MAX_SEND_ATTEMPTS) {
          this.options.logger?.warn(
            { retryAfterMs: error.retryAfterMs, attempt },
            "Telegram rate limited the BuyBot; waiting before retrying",
          );
          await this.sleep(error.retryAfterMs);
          continue;
        }
        this.options.logger?.error(
          { error, signature: message.buy?.buy.signature },
          "BuyBot failed to deliver Telegram message",
        );
        return;
      }
    }
  }

  /**
   * Seeds the seen signature cache on startup so historical buys are not re-sent,
   * then begins polling Helius and optional Telegram group commands.
   */
  async start(): Promise<void> {
    if (this.pollTimer) return;
    try {
      await this.getMarketSnapshot(true);
      const initialTxs = await this.fetchRecentTransactions(HELIUS_PAGE_SIZE);
      for (const tx of initialTxs) {
        this.seenSignatures.add(tx.signature);
      }
      this.initialized = true;
      this.options.logger?.info(
        { seededTransactions: initialTxs.length, mint: this.mint, minUsd: this.minUsd },
        "Sisera Telegram BuyBot initialized and watching for live buys",
      );
    } catch (error) {
      this.options.logger?.warn(
        { error },
        "Sisera Telegram BuyBot initial seed failed; will retry on next poll",
      );
    }

    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);

    if (this.enableCommands) {
      this.commandAbort = new AbortController();
      void this.runCommandLoop(this.commandAbort.signal);
    }
  }

  /**
   * Long-polls Telegram so group commands are answered as soon as they arrive,
   * backing off for a few seconds whenever a poll fails.
   */
  private async runCommandLoop(signal: AbortSignal): Promise<void> {
    await this.seedTelegramUpdatesOffset();
    while (!signal.aborted) {
      const ok = await this.pollTelegramCommands(COMMAND_LONG_POLL_SECONDS, signal);
      if (!ok && !signal.aborted) await this.sleep(5_000);
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.commandAbort?.abort();
    this.commandAbort = null;
  }

  async pollOnce(): Promise<number> {
    if (this.pollingInFlight) return 0;
    this.pollingInFlight = true;
    try {
      if (!this.initialized) {
        const txs = await this.fetchRecentTransactions(HELIUS_PAGE_SIZE);
        for (const tx of txs) this.seenSignatures.add(tx.signature);
        this.initialized = true;
        return 0;
      }
      return await this.processTransactions(await this.fetchUnseenTransactions());
    } catch (error) {
      this.options.logger?.warn({ error }, "Sisera Telegram BuyBot poll error");
      return 0;
    } finally {
      this.pollingInFlight = false;
    }
  }

  private async seedTelegramUpdatesOffset(): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.options.botToken}/getUpdates?offset=-1&limit=1`;
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return;
      const data = (await response.json()) as {
        ok?: boolean;
        result?: Array<{ update_id: number }>;
      };
      const last = data.result?.at(-1);
      if (last) this.lastUpdateId = last.update_id + 1;
    } catch {
      // Ignore if webhook or another consumer is active
    }
  }

  /**
   * Fetches pending group commands, waiting up to `timeoutSeconds` for one to arrive.
   * Returns false when the poll failed, so the caller can back off.
   */
  async pollTelegramCommands(timeoutSeconds = 0, signal?: AbortSignal): Promise<boolean> {
    try {
      const url = new URL(`https://api.telegram.org/bot${this.options.botToken}/getUpdates`);
      url.searchParams.set("offset", String(this.lastUpdateId));
      url.searchParams.set("limit", "10");
      url.searchParams.set("timeout", String(timeoutSeconds));

      const timeout = AbortSignal.timeout((timeoutSeconds + 10) * 1_000);
      const response = await this.fetcher(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) {
        // 409 means another copy of the bot (or a webhook) is reading this bot's updates.
        this.options.logger?.warn(
          { status: response.status },
          "BuyBot could not read Telegram commands",
        );
        return false;
      }
      const payload = (await response.json()) as {
        ok?: boolean;
        result?: Array<{
          update_id: number;
          message?: {
            chat?: { id: number | string };
            text?: string;
          };
        }>;
      };

      for (const update of payload.result ?? []) {
        this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id + 1);
        const text = update.message?.text?.trim() ?? "";
        const chatId = update.message?.chat?.id;
        // Only answer in the configured group, so the bot can't be used to spam other chats.
        if (!text.startsWith("/") || String(chatId) !== this.options.chatId) continue;

        const command = text.split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? "";
        if (!BOT_COMMANDS.has(command)) continue;

        const now = Date.now();
        const lastAnsweredAt = this.commandLastAnsweredAt.get(command) ?? 0;
        if (now - lastAnsweredAt < this.commandCooldownMs) continue;
        this.commandLastAnsweredAt.set(command, now);

        const snapshot = await this.getMarketSnapshot();
        this.enqueue({
          html: formatSiseraStatsMessage(snapshot, this.mint),
          keyboard: buildBuyBotInlineKeyboard(undefined, this.mint, this.terminalUrl),
          media: "stats",
          chatId: this.options.chatId,
        });
      }
      return true;
    } catch {
      // Network errors and aborts during shutdown are retried by the command loop
      return false;
    }
  }
}
