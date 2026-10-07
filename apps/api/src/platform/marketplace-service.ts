import {
  failStrategyCheckout,
  fulfillStrategyCheckout,
  getStrategyCheckout,
  getStrategyListing,
  grantFreeLicense,
  listStrategyLicenses,
  listStrategyListings,
  markStrategyPayment,
  pendingStrategyCheckouts,
  publishStrategy,
  saveStrategyCheckout,
  strategySales,
  unlistStrategy,
} from "@sisera/db";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { z } from "zod";
import { AgentDraftInput, StoredAgentPolicy } from "../agent-governance.js";
import { AgentError, type AgentService } from "./agent-service.js";
import { USDC_MINT } from "./catalog.js";

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
    this.rpc = new Connection(rpcUrl, "confirmed");
  }
  async browse(subject: string) {
    const [listings, licenses, sales] = await Promise.all([
      listStrategyListings(this.db),
      listStrategyLicenses(this.db, subject),
      strategySales(this.db, subject),
    ]);
    const owned = new Set(licenses.map((l) => String(l.listingId)));
    return listings
      .filter((l) => l.status === "published" || l.subject === subject || owned.has(l.id))
      .map((l) => ({
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
        evaluation: "Research template; purchase does not grant live trading approval.",
      }));
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
