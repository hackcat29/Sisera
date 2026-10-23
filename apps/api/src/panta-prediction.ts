import { createHash } from "node:crypto";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import { TradeRejection } from "./solana-trading.js";

const PantaMarketResponse = z.object({
  marketId: z.string().optional(),
  id: z.string().optional(),
  status: z.string().optional(),
  phase: z.string().optional(),
  resolved: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isResolved: z.boolean().optional(),
  isCancelled: z.boolean().optional(),
  closeTime: z.number().optional(),
  endTime: z.number().optional(),
  resolutionTime: z.number().optional(),
  rulesPrimary: z.string().optional(),
  resolutionRules: z.string().optional(),
  resolutionRule: z.string().optional(),
  yesPrice: z.union([z.number(), z.string()]).optional(),
  noPrice: z.union([z.number(), z.string()]).optional(),
  primaryYesPrice: z.union([z.number(), z.string()]).optional(),
  primaryNoPrice: z.union([z.number(), z.string()]).optional(),
  lastYesPrice: z.union([z.number(), z.string()]).optional(),
  virtualSolReserves: z.union([z.number(), z.string()]).optional(),
  virtualYesShares: z.union([z.number(), z.string()]).optional(),
  pricing: z
    .object({
      buyYesPriceUsd: z.number().optional(),
      buyNoPriceUsd: z.number().optional(),
      yes: z.number().optional(),
      no: z.number().optional(),
    })
    .optional(),
});

const PantaTradingStatus = z.object({
  trading_active: z.boolean().optional(),
  active: z.boolean().optional(),
});

const PreparedOrder = z.object({
  transaction: z.string().min(40),
  order: z.object({ orderPubkey: z.string().min(1) }).optional(),
  orderPubkey: z.string().min(1).optional(),
});

const PantaPrimaryQuoteResponse = z.object({
  quoteId: z.string(),
  marketId: z.string().optional(),
  side: z.string().optional(),
  amountUsdc: z.union([z.string(), z.number()]).optional(),
  shares: z.union([z.string(), z.number()]).optional(),
  avgPrice: z.union([z.string(), z.number()]).optional(),
  feeUsdc: z.union([z.string(), z.number()]).optional(),
  expiresAt: z.string().optional(),
});

const PantaInstructionAccount = z.object({
  pubkey: z.string(),
  isSigner: z.boolean(),
  isWritable: z.boolean(),
});

const PantaInstruction = z.object({
  programId: z.string(),
  data: z.string(),
  accounts: z.array(PantaInstructionAccount),
});

const PantaPrimaryBuildResponse = z.object({
  orderId: z.string(),
  quoteId: z.string().optional(),
  wallet: z.string().optional(),
  marketId: z.string().optional(),
  instructions: z.array(PantaInstruction),
  derived: z
    .object({
      userPosition: z.string().optional(),
      marketConfig: z.string().optional(),
      userTokenAccount: z.string().optional(),
      vaultTokenAccount: z.string().optional(),
      treasuryTokenAccount: z.string().optional(),
      vaultAuthority: z.string().optional(),
    })
    .optional(),
  recentBlockhash: z.string().optional(),
});

const PantaClaimBuildResponse = z.object({
  wallet: z.string().optional(),
  marketId: z.string().optional(),
  outcome: z.string().optional(),
  winningShares: z.union([z.string(), z.number()]).optional(),
  instructions: z.array(PantaInstruction),
  derived: z.record(z.unknown()).optional(),
  recentBlockhash: z.string().optional(),
});

export const PantaUserPosition = z.object({
  marketId: z.string(),
  category: z.string().optional(),
  title: z.string().optional(),
  images: z.array(z.string()).optional(),
  side: z.enum(["yes", "no"]),
  shares: z.string(),
  availableShares: z.string().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  currentValueUsdc: z.union([z.string(), z.number()]).optional(),
  phase: z.string().optional(),
  claimable: z.boolean().default(false),
  claimed: z.boolean().default(false),
  claimedPayoutUsdc: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
});
export type PantaUserPosition = z.infer<typeof PantaUserPosition>;

type Fetcher = typeof globalThis.fetch;

export const PANTA_PROGRAM_ID = "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp";
const EVENT_DISCRIMINATOR = Buffer.from([125, 192, 125, 158, 9, 115, 152, 233]);
const PRIMARY_ORDER_DISCRIMINATOR = Buffer.from([42, 135, 249, 48, 230, 60, 223, 84]);

export class PantaPredictionTradingClient {
  private readonly connection: Connection | null;
  private readonly programId: PublicKey;

  constructor(
    private readonly baseUrl = "https://live-api.panta.market/api/v1",
    private readonly apiKey?: string,
    private readonly fetcher: Fetcher = globalThis.fetch,
    rpcUrl?: string,
    programId = PANTA_PROGRAM_ID,
  ) {
    this.programId = new PublicKey(programId);
    this.connection = rpcUrl ? new Connection(rpcUrl, "confirmed") : null;
  }

  async quote(marketId: string, isYes: boolean) {
    // 1. Try Panta REST API if API key provided or custom fetcher injected (e.g. tests)
    const hasCustomFetcher = this.fetcher !== globalThis.fetch;
    if (this.apiKey || hasCustomFetcher) {
      try {
        const base = this.baseUrl.replace(/\/+$/, "");
        const [marketResponse, statusResponse] = await Promise.all([
          this.fetcher(`${base}/markets/${encodeURIComponent(marketId)}/`, {
            headers: this.headers(),
            signal: AbortSignal.timeout(7000),
          }).catch(async () =>
            this.fetcher(`${base}/markets/${encodeURIComponent(marketId)}`, {
              headers: this.headers(),
              signal: AbortSignal.timeout(7000),
            }),
          ),
          this.fetcher(`${base}/trading-status`, {
            headers: this.headers(),
            signal: AbortSignal.timeout(7000),
          }).catch(() => null),
        ]);

        if (marketResponse.ok) {
          const rawMarket = await marketResponse.json();
          const parsed = PantaMarketResponse.safeParse(rawMarket);
          if (parsed.success) {
            const m = parsed.data;
            const mid = m.marketId ?? m.id ?? marketId;
            const status = (m.status ?? "open").toLowerCase();
            const phase = (m.phase ?? "").toLowerCase();
            const isClosed =
              m.resolved === true ||
              m.isResolved === true ||
              m.isCancelled === true ||
              ["closed", "resolved", "cancelled"].includes(status);
            const isActive =
              !isClosed &&
              (m.isActive !== false ||
                ["open", "active", "trading", "primary", "secondary"].includes(status) ||
                ["primary", "secondary"].includes(phase));
            let tradingActive = true;
            if (statusResponse?.ok) {
              const statusData = PantaTradingStatus.safeParse(await statusResponse.json());
              if (statusData.success) {
                tradingActive = statusData.data.trading_active ?? statusData.data.active ?? true;
              }
            }

            if (mid !== marketId || !isActive || !tradingActive) {
              throw new TradeRejection("This prediction market is not open for trading.");
            }
            const closeSec = m.closeTime ?? m.resolutionTime ?? m.endTime;
            if (Number.isFinite(closeSec) && (closeSec as number) * 1000 <= Date.now()) {
              throw new TradeRejection("This prediction market has closed.");
            }
            const rules = m.rulesPrimary ?? m.resolutionRules ?? m.resolutionRule;
            if (rules !== undefined && !rules.trim()) {
              throw new TradeRejection("Resolution rules are unavailable.");
            }

            let price: number | null = null;
            if (m.pricing) {
              const yesPrice =
                m.pricing.buyYesPriceUsd ?? (m.pricing.yes ? m.pricing.yes * 1_000_000 : undefined);
              const noPrice =
                m.pricing.buyNoPriceUsd ?? (m.pricing.no ? m.pricing.no * 1_000_000 : undefined);
              const target = isYes ? yesPrice : noPrice;
              if (target !== undefined && Number.isFinite(target) && target > 0) {
                price = target / 1_000_000;
              }
            }
            if (price === null) {
              const parseNum = (val: unknown) => {
                if (val == null) return null;
                const n = Number(val);
                return Number.isFinite(n) && n > 0 ? n : null;
              };
              const targetVal = isYes
                ? (m.primaryYesPrice ?? m.yesPrice)
                : (m.primaryNoPrice ?? m.noPrice);
              const targetNum = parseNum(targetVal);
              if (targetNum !== null) {
                price = targetNum > 1 ? targetNum / 1_000_000 : targetNum;
              } else if (m.virtualSolReserves != null && m.virtualYesShares != null) {
                const sol = Number(m.virtualSolReserves);
                const yesShares = Number(m.virtualYesShares);
                const total = sol + yesShares;
                if (total > 0) {
                  const rawYes = sol / total;
                  const yes = Math.min(Math.max(rawYes, 0.01), 0.99);
                  price = isYes ? yes : 1 - yes;
                }
              }
            }

            if (price === null || price <= 0 || price >= 1) {
              throw new TradeRejection("This outcome has no valid current buy price.");
            }

            return {
              marketId,
              priceUsd: price.toFixed(6),
              closesAt: Number.isFinite(closeSec)
                ? new Date((closeSec as number) * 1000).toISOString()
                : new Date(Date.now() + 86400 * 1000).toISOString(),
            };
          }
        }
      } catch (error) {
        if (!this.connection) {
          if (error instanceof TradeRejection) throw error;
          throw new TradeRejection("Panta prediction market is unavailable.", 503);
        }
        // Connection available: fall through to on-chain Solana RPC quote fallback
      }
    }

    // 2. On-chain Solana RPC fallback (market-maker-bot / Balr Program)
    if (!this.connection) {
      throw new TradeRejection("Panta prediction market is unavailable.", 503);
    }

    let eventPubkey: PublicKey;
    try {
      eventPubkey = new PublicKey(marketId);
    } catch {
      throw new TradeRejection("Invalid prediction market identifier.");
    }

    const eventInfo = await this.connection.getAccountInfo(eventPubkey);
    if (!eventInfo || !eventInfo.data || eventInfo.data.length < 340) {
      throw new TradeRejection("Panta prediction market is unavailable.", 503);
    }

    const buf = eventInfo.data;
    if (!buf.subarray(0, 8).equals(EVENT_DISCRIMINATOR)) {
      throw new TradeRejection("This account is not a valid Panta prediction event.");
    }

    let offset = 8;
    offset += 32; // creator
    const startTime = Number(buf.readBigInt64LE(offset));
    offset += 8;
    const endTime = Number(buf.readBigInt64LE(offset));
    offset += 8;
    const resolutionTime = Number(buf.readBigInt64LE(offset));
    offset += 8;
    offset += 8 * 3; // createdAt, resolvedAt, cancelledAt
    offset += 16 * 2; // totalYesShares, totalNoShares
    const virtualSolReserves = Number(buf.readBigUInt64LE(offset));
    offset += 16;
    const virtualYesShares = Number(buf.readBigUInt64LE(offset));
    offset += 16;
    offset += 16; // lastYesPrice
    offset += 16; // totalVolume
    offset += 16 + 16 + 8 + 16 + 16 + 16 + 16 + 16 + 8 + 16; // remaining metrics

    if (offset + 4 > buf.length) {
      throw new TradeRejection("Panta prediction market data is malformed.", 503);
    }
    const qLen = buf.readUInt32LE(offset);
    offset += 4;
    offset += qLen; // question

    if (offset + 4 > buf.length) {
      throw new TradeRejection("Panta prediction market data is malformed.", 503);
    }
    const rLen = buf.readUInt32LE(offset);
    offset += 4;
    const resolutionRule = buf.subarray(offset, offset + rLen).toString("utf8");
    offset += rLen;

    if (offset + 4 <= buf.length) {
      const sLen = buf.readUInt32LE(offset);
      offset += 4;
      for (let i = 0; i < sLen; i++) {
        if (offset + 4 > buf.length) break;
        const len = buf.readUInt32LE(offset);
        offset += 4;
        offset += len;
      }
    }

    offset += 16; // activeVolume
    offset += 3; // bumps
    const isActive = buf.readUInt8(offset++) === 1;
    offset++; // isGraduated
    const isResolved = buf.readUInt8(offset++) === 1;
    const isCancelled = buf.readUInt8(offset++) === 1;

    if (!isActive || isResolved || isCancelled) {
      throw new TradeRejection("This prediction market is not open for trading.");
    }

    const closeSec = resolutionTime > 0 ? resolutionTime : endTime > 0 ? endTime : 0;
    if (closeSec > 0 && closeSec * 1000 <= Date.now()) {
      throw new TradeRejection("This prediction market has closed.");
    }

    const totalLiquidity = virtualSolReserves + virtualYesShares;
    const rawYes = totalLiquidity > 0 ? virtualSolReserves / totalLiquidity : 0.5;
    const yes = Math.min(Math.max(rawYes, 0.01), 0.99);
    const price = isYes ? yes : 1 - yes;

    return {
      marketId,
      priceUsd: price.toFixed(6),
      closesAt:
        closeSec > 0
          ? new Date(closeSec * 1000).toISOString()
          : new Date(Date.now() + 86400 * 1000).toISOString(),
    };
  }

  async prepare(input: {
    marketId: string;
    wallet: string;
    isYes: boolean;
    depositAmount: string;
  }) {
    const quote = await this.quote(input.marketId, input.isYes);

    // 1. Try Panta REST API if API key provided or custom fetcher injected
    const hasCustomFetcher = this.fetcher !== globalThis.fetch;
    if (this.apiKey || hasCustomFetcher) {
      const base = this.baseUrl.replace(/\/+$/, "");

      // If no API key is set, try legacy /orders (used by unit tests like jupiter-prediction.test.ts)
      if (!this.apiKey && hasCustomFetcher) {
        try {
          const legacyResponse = await this.fetcher(`${base}/orders`, {
            method: "POST",
            headers: { ...this.headers(), "content-type": "application/json" },
            body: JSON.stringify({
              ownerPubkey: input.wallet,
              marketId: input.marketId,
              isYes: input.isYes,
              isBuy: true,
              depositAmount: input.depositAmount,
              depositMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            }),
            signal: AbortSignal.timeout(10_000),
          });

          if (legacyResponse.ok) {
            const raw = await legacyResponse.json();
            const parsed = PreparedOrder.safeParse(raw);
            if (parsed.success) {
              const orderPubkey = parsed.data.order?.orderPubkey ?? parsed.data.orderPubkey;
              if (orderPubkey) {
                return {
                  transaction: parsed.data.transaction,
                  order: { orderPubkey },
                  priceUsd: Number(quote.priceUsd),
                };
              }
            }
          }
        } catch (err) {
          if (err instanceof TradeRejection) throw err;
        }
      }

      // If API key is provided (production), use Panta's official primaryorderquote + primaryorderbuild
      if (this.apiKey) {
        try {
          const quoteRes = await this.fetcher(`${base}/primaryorderquote/`, {
            method: "POST",
            headers: { ...this.headers(), "content-type": "application/json" },
            body: JSON.stringify({
              wallet: input.wallet,
              marketId: input.marketId,
              side: input.isYes ? "yes" : "no",
              amountUsdc: (Number(input.depositAmount) / 1_000_000).toString(),
            }),
            signal: AbortSignal.timeout(10_000),
          });

          if (quoteRes.ok) {
            const rawQuote = await quoteRes.json();
            // Check if mock returned a pre-built PreparedOrder directly
            const directOrder = PreparedOrder.safeParse(rawQuote);
            if (directOrder.success) {
              const orderPubkey =
                directOrder.data.order?.orderPubkey ?? directOrder.data.orderPubkey;
              if (orderPubkey) {
                return {
                  transaction: directOrder.data.transaction,
                  order: { orderPubkey },
                  priceUsd: Number(quote.priceUsd),
                };
              }
            }

            const quoteData = PantaPrimaryQuoteResponse.safeParse(rawQuote);
            if (quoteData.success) {
              const buildRes = await this.fetcher(`${base}/primaryorderbuild/`, {
                method: "POST",
                headers: { ...this.headers(), "content-type": "application/json" },
                body: JSON.stringify({
                  quoteId: quoteData.data.quoteId,
                  wallet: input.wallet,
                }),
                signal: AbortSignal.timeout(10_000),
              });

              if (buildRes.ok) {
                const rawBuild = await buildRes.json();
                const buildData = PantaPrimaryBuildResponse.safeParse(rawBuild);
                if (buildData.success) {
                  const instructions = buildData.data.instructions.map((ix) => {
                    return new TransactionInstruction({
                      programId: new PublicKey(ix.programId),
                      keys: ix.accounts.map((acc) => ({
                        pubkey: new PublicKey(acc.pubkey),
                        isSigner: acc.isSigner,
                        isWritable: acc.isWritable,
                      })),
                      data: Buffer.from(ix.data, "base64"),
                    });
                  });

                  let recentBlockhash = buildData.data.recentBlockhash;
                  if (!recentBlockhash && this.connection) {
                    const latest = await this.connection.getLatestBlockhash("confirmed");
                    recentBlockhash = latest.blockhash;
                  }

                  if (!recentBlockhash) {
                    throw new TradeRejection(
                      "Failed to obtain recent Solana blockhash for prediction order.",
                    );
                  }

                  const message = new TransactionMessage({
                    payerKey: new PublicKey(input.wallet),
                    recentBlockhash,
                    instructions,
                  }).compileToV0Message();

                  const tx = new VersionedTransaction(message);
                  const txBase64 = Buffer.from(tx.serialize()).toString("base64");
                  const orderPubkey = buildData.data.orderId;

                  return {
                    transaction: txBase64,
                    order: {
                      orderPubkey,
                      pantaOrderId: buildData.data.orderId,
                    },
                    priceUsd: Number(quoteData.data.avgPrice ?? quote.priceUsd),
                  };
                }
              } else {
                const errBody = (await buildRes.json().catch(() => null)) as {
                  message?: string;
                  code?: string;
                } | null;
                const errMsg =
                  errBody?.message ||
                  errBody?.code ||
                  "Panta could not build this prediction order.";
                throw new TradeRejection(errMsg, buildRes.status === 429 ? 503 : 422);
              }
            }
          } else {
            const errBody = (await quoteRes.json().catch(() => null)) as {
              message?: string;
              code?: string;
            } | null;
            const errMsg =
              errBody?.message || errBody?.code || "Panta could not quote this prediction order.";
            throw new TradeRejection(errMsg, quoteRes.status === 429 ? 503 : 422);
          }

          throw new TradeRejection("Panta prediction trading is currently unavailable.", 503);
        } catch (error) {
          if (error instanceof TradeRejection) throw error;
          throw new TradeRejection("Panta prediction trading is currently unavailable.", 503);
        }
      }
    }

    // 2. Direct on-chain transaction construction fallback (Anchor Balr / Panta Program)
    if (!this.connection) {
      throw new TradeRejection("Panta prediction trading is unavailable.", 503);
    }

    let user: PublicKey;
    let eventPda: PublicKey;
    try {
      user = new PublicKey(input.wallet);
      eventPda = new PublicKey(input.marketId);
    } catch {
      throw new TradeRejection("Invalid Solana wallet or market address.");
    }

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market_config")],
      this.programId,
    );

    const [eventInfo, configInfo] = await Promise.all([
      this.connection.getAccountInfo(eventPda),
      this.connection.getAccountInfo(configPda),
    ]);

    if (!eventInfo || !configInfo) {
      throw new TradeRejection("Panta on-chain accounts not found.", 503);
    }

    const creator = new PublicKey(eventInfo.data.subarray(8, 40));
    const offset = 328;
    const qLen = eventInfo.data.readUInt32LE(offset);
    const question = eventInfo.data.subarray(offset + 4, offset + 4 + qLen).toString("utf8");

    const treasury = new PublicKey(configInfo.data.subarray(136, 168));

    const questionHash = createHash("sha256").update(question).digest();
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), creator.toBuffer(), questionHash],
      this.programId,
    );
    const [creatorFeeVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator_fee_vault"), eventPda.toBuffer()],
      this.programId,
    );
    const [userPositionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), eventPda.toBuffer(), user.toBuffer()],
      this.programId,
    );

    const data = Buffer.alloc(17);
    PRIMARY_ORDER_DISCRIMINATOR.copy(data, 0);
    data.writeUInt8(input.isYes ? 0 : 1, 8);
    data.writeBigUInt64LE(BigInt(input.depositAmount), 9);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: eventPda, isSigner: false, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: creatorFeeVaultPda, isSigner: false, isWritable: true },
        { pubkey: userPositionPda, isSigner: false, isWritable: true },
        { pubkey: treasury, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: user,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    const txBase64 = Buffer.from(tx.serialize()).toString("base64");

    return {
      transaction: txBase64,
      order: { orderPubkey: userPositionPda.toBase58() },
      priceUsd: Number(quote.priceUsd),
    };
  }

  async submitOrder(orderId: string, signature: string): Promise<boolean> {
    const hasCustomFetcher = this.fetcher !== globalThis.fetch;
    if (!this.apiKey && !hasCustomFetcher) return false;
    try {
      const base = this.baseUrl.replace(/\/+$/, "");
      const res = await this.fetcher(`${base}/primaryordersubmit/`, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({ orderId, signature }),
        signal: AbortSignal.timeout(6000),
      });
      return res.ok;
    } catch (err) {
      console.warn("[panta-prediction] submitOrder failed:", err);
      return false;
    }
  }

  async orderStatus(orderPubkey: string): Promise<string | null> {
    const hasCustomFetcher = this.fetcher !== globalThis.fetch;
    if (this.apiKey || hasCustomFetcher) {
      const base = this.baseUrl.replace(/\/+$/, "");
      try {
        const verifyRes = await this.fetcher(`${base}/primaryorderverify/`, {
          method: "POST",
          headers: { ...this.headers(), "content-type": "application/json" },
          body: JSON.stringify({ orderId: orderPubkey }),
          signal: AbortSignal.timeout(6000),
        });
        if (verifyRes.ok) {
          const payload = z.object({ status: z.string() }).safeParse(await verifyRes.json());
          if (payload.success) return payload.data.status;
        }
      } catch {
        // Fall through
      }

      try {
        const response = await this.fetcher(
          `${base}/orders/status/${encodeURIComponent(orderPubkey)}`,
          { headers: this.headers(), signal: AbortSignal.timeout(6000) },
        );
        if (response.ok) {
          const payload = z.object({ status: z.string() }).safeParse(await response.json());
          if (payload.success) return payload.data.status;
        }
      } catch {
        // Fall through to on-chain check
      }
    }

    if (this.connection) {
      try {
        const key = new PublicKey(orderPubkey);
        const info = await this.connection.getAccountInfo(key);
        if (info && info.data.length > 0) {
          return "confirmed";
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  async getUserPositions(wallet: string): Promise<PantaUserPosition[]> {
    const hasCustomFetcher = this.fetcher !== globalThis.fetch;
    if (!this.apiKey && !hasCustomFetcher) return [];
    try {
      const base = this.baseUrl.replace(/\/+$/, "");
      const res = await this.fetcher(`${base}/positions/?wallet=${encodeURIComponent(wallet)}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { positions?: unknown[] };
      if (!Array.isArray(data.positions)) return [];
      return data.positions
        .map((p) => PantaUserPosition.safeParse(p))
        .filter((r): r is z.SafeParseSuccess<PantaUserPosition> => r.success)
        .map((r) => r.data);
    } catch (error) {
      console.warn("[panta-prediction] getUserPositions failed:", error);
      return [];
    }
  }

  async buildClaim(input: {
    wallet: string;
    marketId: string;
  }): Promise<{
    transaction: string;
    wallet: string;
    marketId: string;
    outcome?: string | undefined;
    winningShares?: string | undefined;
  }> {
    const hasCustomFetcher = this.fetcher !== globalThis.fetch;
    if (!this.apiKey && !hasCustomFetcher) {
      throw new TradeRejection("Panta claim service is unavailable.", 503);
    }
    const base = this.baseUrl.replace(/\/+$/, "");
    let res: Response;
    try {
      res = await this.fetcher(`${base}/claim/build/`, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          wallet: input.wallet,
          marketId: input.marketId,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      if (err instanceof TradeRejection) throw err;
      throw new TradeRejection("Failed to connect to Panta claim builder.", 503);
    }

    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as {
        code?: string;
        message?: string;
      } | null;
      if (errBody?.code === "NOT_CLAIMABLE") {
        throw new TradeRejection("No claimable winnings found for this wallet and market.", 422);
      }
      const errMsg =
        errBody?.message || errBody?.code || "Claim transaction could not be constructed.";
      throw new TradeRejection(errMsg, res.status === 429 ? 503 : 422);
    }

    const raw = await res.json();
    const directTx = z.object({ transaction: z.string().min(40) }).safeParse(raw);
    if (directTx.success) {
      return {
        transaction: directTx.data.transaction,
        wallet: input.wallet,
        marketId: input.marketId,
      };
    }

    const buildData = PantaClaimBuildResponse.safeParse(raw);
    if (!buildData.success) {
      throw new TradeRejection("Invalid claim response from Panta venue.", 502);
    }

    const instructions = buildData.data.instructions.map((ix) => {
      return new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map((acc) => ({
          pubkey: new PublicKey(acc.pubkey),
          isSigner: acc.isSigner,
          isWritable: acc.isWritable,
        })),
        data: Buffer.from(ix.data, "base64"),
      });
    });

    let recentBlockhash = buildData.data.recentBlockhash;
    if (!recentBlockhash && this.connection) {
      const latest = await this.connection.getLatestBlockhash("confirmed");
      recentBlockhash = latest.blockhash;
    }

    if (!recentBlockhash) {
      throw new TradeRejection("Failed to obtain recent Solana blockhash for claim transaction.");
    }

    const message = new TransactionMessage({
      payerKey: new PublicKey(input.wallet),
      recentBlockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    const txBase64 = Buffer.from(tx.serialize()).toString("base64");

    return {
      transaction: txBase64,
      wallet: input.wallet,
      marketId: input.marketId,
      outcome: buildData.data.outcome,
      winningShares:
        buildData.data.winningShares != null ? String(buildData.data.winningShares) : undefined,
    };
  }

  private headers(): Record<string, string> {
    return {
      accept: "application/json",
      ...(this.apiKey ? { "x-api-key": this.apiKey, authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }
}

/** Backward-compatibility alias for JupiterPredictionTradingClient. */
export { PantaPredictionTradingClient as JupiterPredictionTradingClient };
