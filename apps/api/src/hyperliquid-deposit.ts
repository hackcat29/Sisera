import {
  attachBridgeTransaction,
  claimBridgeTransaction,
  createBridgeTransfer,
  markBridgeSourceSubmitted,
} from "@sisera/db";
import {
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  BridgeUnavailable,
  HYPERLIQUID_CHAIN_ID,
  type RelayBridgeClient,
  SOLANA_CHAIN_ID,
} from "./bridge.js";
import type { HeliusClient } from "./helius.js";
import { verifySignedSwap } from "./solana-trading.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Hyperliquid credits deposits of at least 5 USDC; smaller amounts would be lost. */
const MIN_DEPOSIT_USDC = 5;
const TX_TTL_MS = 60_000;
const MIN_FEE_LAMPORTS = 1_000_000n;

/**
 * Deposits Solana USDC into the user's Hyperliquid perps balance through Relay, in about a second.
 * Sisera builds the transaction from Relay's verified instruction; the user's Solana wallet signs
 * it, and Sisera checks the signed copy matches before broadcasting.
 */
export class HyperliquidDepositService {
  private readonly connection: Connection;

  constructor(
    private readonly options: {
      databaseUrl: string | undefined;
      relay: RelayBridgeClient;
      helius: HeliusClient;
      rpcUrl: string;
      maxUsd: number;
    },
  ) {
    this.connection = new Connection(options.rpcUrl, "confirmed");
  }

  async prepare(input: {
    subject: string;
    tenantId: string;
    wallet: string;
    recipient: string;
    amountUsdc: string;
  }) {
    const databaseUrl = this.options.databaseUrl;
    if (!databaseUrl) throw new BridgeUnavailable("Deposits are not available right now.");
    const amount = Number(input.amountUsdc);
    if (!Number.isFinite(amount) || amount < MIN_DEPOSIT_USDC)
      throw new BridgeUnavailable(`Deposits must be at least ${MIN_DEPOSIT_USDC} USDC.`, 422);
    if (amount > this.options.maxUsd)
      throw new BridgeUnavailable(
        `Deposits are limited to $${this.options.maxUsd.toLocaleString("en-US")} each.`,
        422,
      );
    const [usdc, lamports] = await Promise.all([
      this.options.helius.getTokenBalance(input.wallet, USDC),
      this.options.helius.getSolLamports(input.wallet),
    ]).catch(() => {
      throw new BridgeUnavailable("Wallet balances are unavailable. Try again shortly.");
    });
    if (BigInt(usdc.rawBalance) < BigInt(Math.round(amount * 1_000_000)))
      throw new BridgeUnavailable("Your Solana wallet does not have that much USDC.", 422);
    if (BigInt(lamports) < MIN_FEE_LAMPORTS)
      throw new BridgeUnavailable("Add a little SOL (0.001) to your wallet for network fees.", 422);

    const quote = await this.options.relay.solanaDepositQuote({
      user: input.wallet,
      recipient: input.recipient,
      amountUsdc: input.amountUsdc,
    });
    if (Number(quote.outputAmountUsdc) < MIN_DEPOSIT_USDC)
      throw new BridgeUnavailable(
        `Hyperliquid needs at least ${MIN_DEPOSIT_USDC} USDC to arrive after fees. Deposit a little more.`,
        422,
      );
    const lookupTables = (
      await Promise.all(
        quote.lookupTables.map((address) =>
          this.connection.getAddressLookupTable(new PublicKey(address)),
        ),
      )
    )
      .map((result) => result.value)
      .filter((table): table is AddressLookupTableAccount => table != null);
    if (lookupTables.length !== quote.lookupTables.length)
      throw new BridgeUnavailable("The deposit route is unavailable. Try again shortly.");
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: new PublicKey(input.wallet),
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        ...quote.instructions.map(
          (instruction) =>
            new TransactionInstruction({
              programId: new PublicKey(instruction.programId),
              keys: instruction.keys.map((key) => ({
                pubkey: new PublicKey(key.pubkey),
                isSigner: key.isSigner,
                isWritable: key.isWritable,
              })),
              data: Buffer.from(instruction.data, "hex"),
            }),
        ),
      ],
    }).compileToV0Message(lookupTables);
    const transaction = Buffer.from(new VersionedTransaction(message).serialize()).toString(
      "base64",
    );
    await createBridgeTransfer(databaseUrl, {
      requestId: quote.requestId,
      tenantId: input.tenantId,
      subject: input.subject,
      originAddress: input.wallet,
      recipient: quote.recipient,
      originChainId: SOLANA_CHAIN_ID,
      destinationChainId: HYPERLIQUID_CHAIN_ID,
      originAmountUsdc: quote.originAmountUsdc,
      quotedOutputUsdc: quote.outputAmountUsdc,
    });
    const expiresAt = new Date(Date.now() + TX_TTL_MS);
    if (
      !(await attachBridgeTransaction(
        databaseUrl,
        input.subject,
        quote.requestId,
        transaction,
        expiresAt,
      ))
    )
      throw new BridgeUnavailable(
        "This deposit was already submitted. Refresh and try again.",
        409,
      );
    return {
      requestId: quote.requestId,
      transaction,
      wallet: input.wallet,
      amountUsdc: quote.originAmountUsdc,
      outputAmountUsdc: quote.outputAmountUsdc,
      minimumOutputUsdc: quote.minimumOutputUsdc,
      feeUsd: Object.entries(quote.fees)
        .filter(([name]) => name === "gas" || name === "relayer")
        .reduce((sum, [, fee]) => sum + Number((fee as { amountUsd?: string })?.amountUsd ?? 0), 0)
        .toFixed(2),
      timeEstimateSeconds: quote.timeEstimateSeconds,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async execute(input: { subject: string; requestId: string; signedTransaction: string }) {
    const databaseUrl = this.options.databaseUrl;
    if (!databaseUrl) throw new BridgeUnavailable("Deposits are not available right now.");
    const pending = await claimBridgeTransaction(databaseUrl, input.subject, input.requestId);
    if (!pending)
      throw new BridgeUnavailable("This deposit expired. Review it again for a fresh quote.", 422);
    try {
      verifySignedSwap(pending.unsignedTransaction, input.signedTransaction, pending.originAddress);
    } catch (error) {
      throw new BridgeUnavailable(
        error instanceof Error ? error.message : "The deposit signature is invalid.",
        422,
      );
    }
    let signature: string;
    try {
      signature = await this.connection.sendRawTransaction(
        Buffer.from(input.signedTransaction, "base64"),
        { maxRetries: 3, skipPreflight: false },
      );
    } catch {
      throw new BridgeUnavailable(
        "The deposit could not be sent. Nothing left your wallet; try again.",
        422,
      );
    }
    await markBridgeSourceSubmitted(databaseUrl, input.subject, input.requestId, signature);
    const confirmation = await this.connection
      .confirmTransaction(signature, "confirmed")
      .catch(() => null);
    if (confirmation?.value.err)
      return { status: "failed" as const, signature, requestId: input.requestId };
    return {
      status: confirmation ? ("submitted" as const) : ("pending" as const),
      signature,
      requestId: input.requestId,
    };
  }
}
