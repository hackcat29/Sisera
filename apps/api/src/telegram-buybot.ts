import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
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

/**
 * Formats the HTML caption/message for a $SISERA buy alert in Telegram.
 */
export function formatSiseraBuyMessage(
  buy: SiseraBuyEvent,
  snapshot: SiseraMarketSnapshot,
  holder?: SiseraBuyerHolderInfo | null,
): string {
  const usdValue = computeBuyUsdValue(buy, snapshot);

  let tierHeader = "🟢 <b>SISERA BUY!</b>";
  let orbEmoji = "🟢";
  if (usdValue >= 2_000) {
    tierHeader = "🐋 <b>SISERA WHALE ALLOCATION!</b>";
    orbEmoji = "🏛️";
  } else if (usdValue >= 500) {
    tierHeader = "🏛️ <b>SISERA INSTITUTIONAL BUY!</b>";
  } else if (usdValue >= 100) {
    tierHeader = "⚡ <b>SISERA QUANT BUY!</b>";
  }

  // 1 orb per $10 spent (minimum 3 orbs, maximum 36 orbs)
  const orbCount = Math.max(3, Math.min(36, Math.ceil(usdValue / 10)));
  const orbBar = orbEmoji.repeat(orbCount);

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
    tierHeader,
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

export interface SiseraTelegramBuyBotOptions {
  botToken: string;
  chatId: string;
  heliusApiKey: string;
  mint?: string;
  minUsd?: number;
  pollIntervalMs?: number;
  terminalUrl?: string;
  mediaPath?: string;
  enableCommands?: boolean;
  heliusClient?: HeliusClient;
  fetcher?: typeof fetch;
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
  private readonly mediaPath: string;
  private readonly enableCommands: boolean;
  private readonly fetcher: typeof fetch;
  private readonly knownPools = new Set<string>([SISERA_PRIMARY_POOL]);
  private readonly seenSignatures = new Set<string>();
  private cachedPhotoFileId: string | null = null;
  private cachedSnapshot: { data: SiseraMarketSnapshot; fetchedAt: number } | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private commandTimer: ReturnType<typeof setInterval> | null = null;
  private lastUpdateId = 0;
  private initialized = false;
  private pollingInFlight = false;

  constructor(private readonly options: SiseraTelegramBuyBotOptions) {
    this.mint = options.mint ?? SISERA_MINT;
    this.minUsd = options.minUsd ?? 5;
    this.pollIntervalMs = options.pollIntervalMs ?? 10_000;
    this.terminalUrl = options.terminalUrl ?? "https://sisera.xyz";
    this.mediaPath = options.mediaPath ?? resolve(process.cwd(), "stickers", "01-bullish.png");
    this.enableCommands = options.enableCommands ?? true;
    this.fetcher = options.fetcher ?? globalThis.fetch;
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
      const primary =
        pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;

      const priceUsd = primary?.priceUsd ?? 0;
      const priceNativeSol = primary?.priceNative ?? 0;
      const solPriceUsd = priceUsd > 0 && priceNativeSol > 0 ? priceUsd / priceNativeSol : 150;
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
      return {
        priceUsd: 0,
        priceNativeSol: 0,
        solPriceUsd: 150,
        marketCapUsd: 0,
        liquidityUsd: 0,
        volume24hUsd: 0,
        priceChange24hPct: null,
        pairAddresses: [...this.knownPools],
      };
    }
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
   * Fetches latest enhanced transactions for $SISERA from Helius.
   */
  async fetchRecentTransactions(limit = 20): Promise<HeliusEnhancedTx[]> {
    const url = new URL(`https://api.helius.xyz/v0/addresses/${this.mint}/transactions`);
    url.searchParams.set("api-key", this.options.heliusApiKey);
    url.searchParams.set("limit", String(limit));
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      throw new Error(`Helius transactions endpoint returned ${response.status}`);
    }
    return z.array(HeliusEnhancedTransaction).parse(await response.json());
  }

  /**
   * Sends a message or photo to the configured Telegram chat.
   */
  async sendTelegramAlert(
    htmlCaption: string,
    replyMarkup: { inline_keyboard: Array<Array<{ text: string; url: string }>> },
    targetChatId: string = this.options.chatId,
  ): Promise<void> {
    const baseUrl = `https://api.telegram.org/bot${this.options.botToken}`;

    // Try sending with the official Sisera image/sticker first
    if (this.cachedPhotoFileId || existsSync(this.mediaPath)) {
      try {
        let response: Response;
        if (this.cachedPhotoFileId) {
          response = await this.fetcher(`${baseUrl}/sendPhoto`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: targetChatId,
              photo: this.cachedPhotoFileId,
              caption: htmlCaption,
              parse_mode: "HTML",
              reply_markup: replyMarkup,
            }),
            signal: AbortSignal.timeout(8_000),
          });
        } else {
          const bytes = await readFile(this.mediaPath);
          const form = new FormData();
          form.set("chat_id", targetChatId);
          form.set("caption", htmlCaption);
          form.set("parse_mode", "HTML");
          form.set("reply_markup", JSON.stringify(replyMarkup));
          form.set("photo", new Blob([bytes], { type: "image/png" }), basename(this.mediaPath));
          response = await this.fetcher(`${baseUrl}/sendPhoto`, {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(10_000),
          });
        }

        if (response.ok) {
          const payload = (await response.json()) as {
            ok?: boolean;
            result?: { photo?: Array<{ file_id?: string }> };
          };
          const fileId = payload.result?.photo?.at(-1)?.file_id;
          if (fileId) this.cachedPhotoFileId = fileId;
          return;
        }
        // Reset cached file_id if Telegram rejected it
        this.cachedPhotoFileId = null;
      } catch (error) {
        this.options.logger?.warn(
          { error },
          "BuyBot sendPhoto failed, falling back to sendMessage",
        );
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

    if (!fallbackResponse.ok) {
      const errorText = await fallbackResponse.text().catch(() => "");
      throw new Error(`Telegram sendMessage failed (${fallbackResponse.status}): ${errorText}`);
    }
  }

  /**
   * Evaluates a batch of Helius transactions, deduplicates by signature, and posts qualifying buys.
   */
  async processTransactions(transactions: HeliusEnhancedTx[]): Promise<number> {
    const unseen = transactions.filter((tx) => !this.seenSignatures.has(tx.signature));
    for (const tx of unseen) {
      this.seenSignatures.add(tx.signature);
    }
    if (this.seenSignatures.size > 2_000) {
      const oldest = [...this.seenSignatures].slice(0, 500);
      for (const sig of oldest) this.seenSignatures.delete(sig);
    }

    if (unseen.length === 0) return 0;
    const snapshot = await this.getMarketSnapshot();

    // Process from oldest to newest so group alerts appear in chronological order
    const chronological = [...unseen].reverse();
    let alertsSent = 0;

    for (const tx of chronological) {
      const buy = extractSiseraBuy(tx, this.mint, this.knownPools);
      if (!buy) continue;

      const usdValue = computeBuyUsdValue(buy, snapshot);
      if (usdValue < this.minUsd) continue;

      const holderInfo = await this.getBuyerHolderInfo(buy.buyer, buy.tokenAmount);
      const html = formatSiseraBuyMessage(buy, snapshot, holderInfo);
      const keyboard = buildBuyBotInlineKeyboard(buy.signature, this.mint, this.terminalUrl);

      await this.sendTelegramAlert(html, keyboard);
      alertsSent++;
      this.options.logger?.info(
        {
          signature: buy.signature,
          buyer: buy.buyer,
          tokenAmount: buy.tokenAmount,
          usdValue: Number(usdValue.toFixed(2)),
        },
        "Sent Telegram $SISERA buy alert",
      );
    }

    return alertsSent;
  }

  /**
   * Seeds the seen signature cache on startup so historical buys are not re-sent,
   * then begins polling Helius and optional Telegram group commands.
   */
  async start(): Promise<void> {
    if (this.pollTimer) return;
    try {
      await this.getMarketSnapshot(true);
      const initialTxs = await this.fetchRecentTransactions(25);
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
      void this.seedTelegramUpdatesOffset();
      this.commandTimer = setInterval(() => {
        void this.pollTelegramCommands();
      }, 5_000);
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.commandTimer) {
      clearInterval(this.commandTimer);
      this.commandTimer = null;
    }
  }

  async pollOnce(): Promise<number> {
    if (this.pollingInFlight) return 0;
    this.pollingInFlight = true;
    try {
      const txs = await this.fetchRecentTransactions(20);
      if (!this.initialized) {
        for (const tx of txs) this.seenSignatures.add(tx.signature);
        this.initialized = true;
        return 0;
      }
      return await this.processTransactions(txs);
    } catch (error) {
      this.options.logger?.warn({ error }, "Sisera Telegram BuyBot poll error");
      return 0;
    } finally {
      this.pollingInFlight = false;
    }
  }

  /**
   * Sends a test buy alert using the latest real on-chain $SISERA buy from Helius
   * (or a sample buy if no recent buy is found).
   */
  async sendLatestRealBuyPreview(): Promise<{
    sent: boolean;
    buy: SiseraBuyEvent;
    html: string;
  }> {
    const snapshot = await this.getMarketSnapshot(true);
    const txs = await this.fetchRecentTransactions(25);
    let latestBuy: SiseraBuyEvent | null = null;
    for (const tx of txs) {
      const candidate = extractSiseraBuy(tx, this.mint, this.knownPools);
      if (candidate) {
        latestBuy = candidate;
        break;
      }
    }

    if (!latestBuy) {
      latestBuy = {
        signature:
          "35jrUQxTXiU915dYDGf1s6Tj3J78QjEwYoFnma5Hiu4xmMrMLsFGrkiQQ1Xdf4i6f4i78YhtzqqJgYQKMzgmz46w",
        timestamp: Math.floor(Date.now() / 1000),
        buyer: "2tgUbS9UMoQD6GkDZBiqKYCURnGrSb6ocYwRABrSJUvY",
        tokenAmount: 907_361.26,
        solSpent: 0.2589,
        usdcSpent: 0,
        source: "PUMP_AMM",
      };
    }

    const holderInfo = await this.getBuyerHolderInfo(latestBuy.buyer, latestBuy.tokenAmount);
    const html = formatSiseraBuyMessage(latestBuy, snapshot, holderInfo);
    const keyboard = buildBuyBotInlineKeyboard(latestBuy.signature, this.mint, this.terminalUrl);

    if (this.options.botToken && this.options.chatId) {
      await this.sendTelegramAlert(html, keyboard);
      return { sent: true, buy: latestBuy, html };
    }
    return { sent: false, buy: latestBuy, html };
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

  private async pollTelegramCommands(): Promise<void> {
    try {
      const url = new URL(`https://api.telegram.org/bot${this.options.botToken}/getUpdates`);
      url.searchParams.set("offset", String(this.lastUpdateId));
      url.searchParams.set("limit", "10");
      url.searchParams.set("timeout", "0");

      const response = await this.fetcher(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return;
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
        if (!text.startsWith("/") || !chatId) continue;

        const command = text.split(/\s+/)[0]?.split("@")[0]?.toLowerCase();
        if (
          command === "/price" ||
          command === "/stats" ||
          command === "/burn" ||
          command === "/ca"
        ) {
          const snapshot = await this.getMarketSnapshot();
          const statsHtml = formatSiseraStatsMessage(snapshot, this.mint);
          const keyboard = buildBuyBotInlineKeyboard(undefined, this.mint, this.terminalUrl);
          await this.sendTelegramAlert(statsHtml, keyboard, String(chatId));
        }
      }
    } catch {
      // Non-fatal command polling error
    }
  }
}
