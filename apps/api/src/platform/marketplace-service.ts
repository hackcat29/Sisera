import {
  failStrategyCheckout,
  fulfillStrategyCheckout,
  getStrategyCheckout,
  getStrategyListing,
  grantFreeLicense,
  listStrategyLicenses,
  listStrategyListings,
  markStrategyPayment,
  marketplaceEvidence,
  marketplaceReputation,
  pendingStrategyCheckouts,
  publishStrategy,
  saveStrategyCheckout,
  saveStrategyReview,
  saveTradeProof,
  strategyReviews,
  strategySales,
  unlistStrategy,
} from "@sisera/db";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { z } from "zod";
import { AgentDraftInput, StoredAgentPolicy } from "../agent-governance.js";
import { AgentError, type AgentService } from "./agent-service.js";
import { USDC_MINT } from "./catalog.js";
import { type EvidenceFill, strategyPerformance } from "./strategy-evidence.js";

const MetricNumbers = z.record(z.number().finite().nullable());
const GateSummary = z.object({
  outcome: z.string(),
  checks: z
    .array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() }))
    .optional(),
});
const PublicEvaluation = z.object({
  engine: z.string().optional(),
  feeBps: z.number().optional(),
  stats: MetricNumbers.optional(),
  gate: GateSummary.optional(),
  scenarios: z.array(z.string()).optional(),
  perSymbol: z
    .array(
      z.object({
        entry: z.string(),
        source: z.string().optional(),
        basis: z.string().optional(),
        years: z.number().optional(),
        metrics: MetricNumbers.optional(),
        gate: GateSummary.optional(),
        outcome: z.string(),
        results: z
          .array(
            z.object({
              name: z.string().optional(),
              scenario: z.string().optional(),
              totalReturnPct: z.number().optional(),
              maxDrawdownPct: z.number().optional(),
              survived: z.boolean().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});
export function publicEvaluation(raw: unknown) {
  const value = PublicEvaluation.safeParse(raw);
  return value.success ? value.data : null;
}
type Principal = Parameters<AgentService["create"]>[0];
export const ListingInput = z
  .object({
    agentId: z.string().regex(/^custom:[0-9a-f-]{36}$/),
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().min(20).max(1000),
    creatorName: z.string().trim().min(2).max(50),
    category: z.enum(["trend", "mean_reversion", "arbitrage", "event", "other"]),
    payoutWallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    priceUsdc: z.number().min(0).max(10000).multipleOf(0.01),
  })
  .strict();

/** Only portable strategy rules are sold. Keys, live wallets, state and promotion evidence stay with the creator. */
export function portableDraft(name: string, raw: unknown) {
  const p = StoredAgentPolicy.parse(raw);
  return AgentDraftInput.parse({
    name,
    description: p.description ?? "Licensed strategy imported from the Sisera marketplace.",
    universe: p.universe,
    timeframe: p.timeframe,
    factors: p.factors,
    capitalLimitUsd: p.capitalAllocation.maxCapitalUsd,
    maxTradeNotionalUsd: p.capitalAllocation.maxTradeNotionalUsd,
    maxDailyDrawdownPct: p.riskGuardrails.maxDailyDrawdownPct,
    maxOpenPositions: p.riskGuardrails.maxOpenPositions,
    stopLossPct: p.riskGuardrails.stopLossPct,
    takeProfitPct: p.riskGuardrails.takeProfitPct,
    maxSlippageBps: p.execution.maxSlippageBps,
    ...(p.rules ? { rules: p.rules } : {}),
  });
}
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM = new PublicKey("11111111111111111111111111111111");
const mint = new PublicKey(USDC_MINT);
const tokenAddress = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA)[0];

export function paymentTransaction(
  payer: string,
  recipient: string,
  priceUsdc: number,
  reference: string,
) {
  const from = new PublicKey(payer);
  const to = new PublicKey(recipient);
  const destination = tokenAddress(to);
  const transaction = new Transaction();
  transaction.feePayer = from;
  // Idempotent associated-token-account creation lets a creator receive USDC for the first time.
  transaction.add(
    new TransactionInstruction({
      programId: ATA,
      data: Buffer.from([1]),
      keys: [
        { pubkey: from, isSigner: true, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: to, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SYSTEM, isSigner: false, isWritable: false },
        { pubkey: TOKEN, isSigner: false, isWritable: false },
      ],
    }),
  );
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(BigInt(Math.round(priceUsdc * 1e6)), 1);
  data[9] = 6;
  transaction.add(
    new TransactionInstruction({
      programId: TOKEN,
      data,
      keys: [
        { pubkey: tokenAddress(from), isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: from, isSigner: true, isWritable: false },
      ],
    }),
  );
  transaction.add(
    new TransactionInstruction({
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      keys: [],
      data: Buffer.from(`sisera:strategy:${reference}`),
    }),
  );
  return transaction;
}
export function validateSignedPayment(prepared: string, signed: string) {
  const expected = Transaction.from(Buffer.from(prepared, "base64"));
  const actual = Transaction.from(Buffer.from(signed, "base64"));
  if (!actual.serializeMessage().equals(expected.serializeMessage()) || !actual.verifySignatures())
    throw new AgentError("Payment differs from the approved checkout.", 422);
  return actual;
}

function base58(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

export class MarketplaceService {
  private readonly rpc: Connection;
  constructor(
    private readonly db: string,
    private readonly agents: AgentService,
    rpcUrl: string,
  ) {
    this.rpc = new Connection(rpcUrl, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 10000,
    });
  }
  async browse(subject: string) {
    const [listings, licenses, sales, reputations] = await Promise.all([
      listStrategyListings(this.db),
      listStrategyLicenses(this.db, subject),
      strategySales(this.db, subject),
      marketplaceReputation(this.db),
    ]);
    const owned = new Set(licenses.map((l) => String(l.listingId)));
    const visible = listings.filter(
      (l) => l.status === "published" || l.subject === subject || owned.has(l.id),
    );
    const evidence = new Map(
      await Promise.all(
        visible.map(
          async (l) => [l.id, await this.performance(l.agentId, l.manifestVersion)] as const,
        ),
      ),
    );
    const creatorStats = new Map<
      string,
      { listings: number; licenses: number; rating: number | null; reviews: number }
    >();
    for (const l of listings) {
      const r = reputations.find((r) => r.id === l.id);
      const c = creatorStats.get(l.subject) ?? {
        listings: 0,
        licenses: 0,
        rating: null,
        reviews: 0,
      };
      const count = Number(r?.reviewCount ?? 0);
      const previous = c.reviews;
      if (count)
        c.rating =
          ((c.rating ?? 0) * previous + Number(r?.rating ?? 0) * count) / (previous + count);
      c.listings++;
      c.licenses += Number(r?.licenses ?? 0);
      c.reviews += count;
      creatorStats.set(l.subject, c);
    }
    return visible.map((l) => ({
      id: l.id,
      title: l.title,
      description: l.description,
      creatorName: l.creatorName,
      category: l.category,
      priceUsdc: l.priceUsdc,
      version: l.manifestVersion,
      status: l.status,
      isCreator: l.subject === subject,
      licensed: owned.has(l.id),
      ...(l.subject === subject
        ? {
            sales: sales.find((s) => s.id === l.id)?.sales ?? 0,
            earnedUsdc: sales.find((s) => s.id === l.id)?.earnedUsdc ?? 0,
          }
        : {}),
      universe: AgentDraftInput.parse(l.draft).universe,
      evaluation: evidence.get(l.id)?.verified.trades
        ? "Onchain history"
        : evidence.get(l.id)?.live.trades
          ? "Recorded live"
          : "Research draft",
      performance: evidence.get(l.id),
      reputation: reputations.find((r) => r.id === l.id),
      creator: creatorStats.get(l.subject),
    }));
  }
  private async performance(agentId: string, version: string) {
    const result = await marketplaceEvidence(this.db, agentId, version);
    const fills = result.fills.map((f) => ({
      ...f,
      id: String(f.id),
      mode: String(f.mode),
      venue: String(f.venue),
      instrumentKey: String(f.instrumentKey),
      side: String(f.side),
      quantity: Number(f.quantity),
      priceUsd: Number(f.priceUsd),
      feeUsd: Number(f.feeUsd),
      signature: f.signature == null ? null : String(f.signature),
      occurredAt: new Date(f.occurredAt).toISOString(),
      verified: Boolean(f.verified),
    })) as EvidenceFill[];
    return {
      live: strategyPerformance(fills.filter((f) => f.mode === "live")),
      paper: strategyPerformance(fills.filter((f) => f.mode === "paper")),
      verified: strategyPerformance(fills.filter((f) => f.mode === "live" && f.verified)),
      evaluations: result.evaluations.map((e) => ({
        id: e.id,
        stage: e.stage,
        outcome: e.outcome,
        windowStart: e.windowStart,
        windowEnd: e.windowEnd,
        recordedAt: e.recordedAt,
        engineRecorded: e.engineRecorded,
        manifestHash: e.manifestHash,
      })),
      updatedAt: new Date().toISOString(),
      coverage: "Recorded trade fees only; funding and unrecorded network costs excluded",
    };
  }
  async detail(subject: string, id: string) {
    const listing = await getStrategyListing(this.db, id);
    const licensed = (await listStrategyLicenses(this.db, subject)).some((l) => l.listingId === id);
    if (!listing || (listing.status !== "published" && listing.subject !== subject && !licensed))
      throw new AgentError("Listing not found.", 404);
    const evidence = await marketplaceEvidence(this.db, listing.agentId, listing.manifestVersion);
    const pending = [
      ...new Set(
        evidence.fills
          .filter(
            (f) =>
              f.mode === "live" &&
              f.venue === "solana" &&
              f.signature &&
              /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(f.signature)) &&
              !f.verified,
          )
          .map((f) => String(f.signature)),
      ),
    ].slice(0, 256);
    if (pending.length) {
      try {
        const statuses = await this.rpc.getSignatureStatuses(pending, {
          searchTransactionHistory: true,
        });
        for (const [i, status] of statuses.value.entries())
          if (status?.confirmationStatus === "finalized" && !status.err) {
            const signature = pending[i];
            if (signature) await saveTradeProof(this.db, signature, status.slot);
          }
      } catch {
        /* Verification remains unavailable instead of asserting success. */
      }
    }
    const updated = await marketplaceEvidence(this.db, listing.agentId, listing.manifestVersion);
    const [reviews, performance] = await Promise.all([
      strategyReviews(this.db, id, subject),
      this.performance(listing.agentId, listing.manifestVersion),
    ]);
    return {
      id,
      version: listing.manifestVersion,
      performance,
      reviews,
      evaluations: updated.evaluations.map((e) => ({
        id: e.id,
        stage: e.stage,
        outcome: e.outcome,
        windowStart: e.windowStart,
        windowEnd: e.windowEnd,
        engineRecorded: e.engineRecorded,
        evidence: publicEvaluation(e.evidence),
      })),
      trades: updated.fills.slice(-100).map((f) => ({
        mode: f.mode,
        symbol: f.symbol,
        side: f.side,
        quantity: f.quantity,
        priceUsd: f.priceUsd,
        feeUsd: f.feeUsd,
        time: f.occurredAt,
        verified: f.verified,
        explorerUrl:
          f.venue === "solana" && f.signature ? `https://solscan.io/tx/${f.signature}` : null,
      })),
      rules: licensed || listing.subject === subject ? AgentDraftInput.parse(listing.draft) : null,
      canReview: licensed && listing.subject !== subject,
    };
  }
  async review(subject: string, id: string, input: unknown) {
    const review = z
      .object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500) })
      .strict()
      .parse(input);
    const listing = await getStrategyListing(this.db, id);
    if (!listing) throw new AgentError("Listing not found.", 404);
    if (
      listing.subject === subject ||
      !(await listStrategyLicenses(this.db, subject)).some((l) => l.listingId === id)
    )
      throw new AgentError("Only licensed buyers can review.", 403);
    await saveStrategyReview(this.db, id, subject, review.rating, review.comment);
    return { id };
  }
  async publish(principal: Principal, body: unknown) {
    const input = ListingInput.parse(body);
    const detail = await this.agents.detail(principal, input.agentId);
    if (detail.manifest.ownerSubject !== principal.subject)
      throw new AgentError("Only the strategy owner can publish.", 403);
    if (!detail.policy.rules)
      throw new AgentError("Add executable rules before listing this strategy.");
    const row = await publishStrategy(this.db, {
      ...input,
      subject: principal.subject,
      manifestVersion: detail.manifest.version,
      draft: portableDraft(input.title, detail.policy),
    });
    if (!row) throw new AgentError("This strategy version is already listed.", 409);
    return { id: row.id };
  }
  async unlist(subject: string, id: string) {
    if (!(await unlistStrategy(this.db, id, subject)))
      throw new AgentError("Listing not found.", 404);
    return { id };
  }
  async checkout(subject: string, id: string, wallet?: string) {
    const listing = await getStrategyListing(this.db, id);
    if (!listing || listing.status !== "published")
      throw new AgentError("Listing not available.", 404);
    if (
      listing.subject === subject ||
      (await listStrategyLicenses(this.db, subject)).some((l) => l.listingId === id)
    )
      throw new AgentError("You already have access to this strategy.", 409);
    if (!listing.priceUsdc) {
      await grantFreeLicense(this.db, id, subject);
      return { licensed: true, id: null, transaction: null };
    }
    if (!wallet) throw new AgentError("Connect a Solana wallet to purchase this strategy.");
    const checkoutId = crypto.randomUUID();
    const transaction = paymentTransaction(
      wallet,
      listing.payoutWallet,
      listing.priceUsdc,
      checkoutId,
    );
    transaction.recentBlockhash = (await this.rpc.getLatestBlockhash()).blockhash;
    const encoded = transaction.serialize({ requireAllSignatures: false }).toString("base64");
    const saved = await saveStrategyCheckout(this.db, {
      id: checkoutId,
      listingId: id,
      subject,
      wallet,
      priceUsdc: listing.priceUsdc,
      transaction: encoded,
    });
    if (!saved)
      throw new AgentError(
        "A checkout already exists for this strategy. Confirm your pending payment or wait five minutes for an unsigned checkout to expire.",
        409,
      );
    return {
      id: checkoutId,
      transaction: encoded,
      priceUsdc: listing.priceUsdc,
      recipient: listing.payoutWallet,
      licensed: false,
    };
  }
  async pending(subject: string) {
    return pendingStrategyCheckouts(this.db, subject);
  }
  async settle(subject: string, id: string, signed?: string) {
    const c = await getStrategyCheckout(this.db, id, subject);
    if (!c) throw new AgentError("Checkout not found.", 404);
    if (c.status === "failed") return { licensed: false, pending: false, failed: true };
    const transaction = signed
      ? validateSignedPayment(String(c.unsigned_transaction), signed)
      : null;
    const signature = transaction?.signature
      ? base58(transaction.signature)
      : c.signature
        ? String(c.signature)
        : null;
    if (!signature) throw new AgentError("Sign your prepared checkout before submitting it.");
    if (!(await markStrategyPayment(this.db, id, subject, signature)))
      throw new AgentError("Checkout already settled.", 409);
    let status = (
      await this.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })
    ).value[0];
    if (!status) {
      const blockhash = Transaction.from(
        Buffer.from(String(c.unsigned_transaction), "base64"),
      ).recentBlockhash;
      if (!blockhash || !(await this.rpc.isBlockhashValid(blockhash)).value) {
        await failStrategyCheckout(this.db, id, subject);
        return { licensed: false, pending: false, failed: true };
      }
      if (transaction) {
        // Rebroadcasting identical signed bytes is idempotent; retries never create another payment.
        await this.rpc.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
        status = (
          await this.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })
        ).value[0];
      }
    }
    if (status?.err) {
      await failStrategyCheckout(this.db, id, subject);
      return { licensed: false, pending: false, failed: true };
    }
    if (status?.confirmationStatus !== "finalized")
      return { licensed: false, signature, pending: true };
    await fulfillStrategyCheckout(this.db, id, subject, signature);
    return { licensed: true, signature, pending: false };
  }
  async import(principal: Principal, id: string) {
    const l = await getStrategyListing(this.db, id);
    if (!l) throw new AgentError("Listing not found.", 404);
    if (
      l.subject !== principal.subject &&
      !(await listStrategyLicenses(this.db, principal.subject)).some((v) => v.listingId === id)
    )
      throw new AgentError("Purchase a license before importing.", 403);
    return this.agents.create(principal, AgentDraftInput.parse(l.draft));
  }
}
