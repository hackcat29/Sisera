import type { HeliusClient } from "./helius.js";
import { JupiterOrderError, type JupiterQuoteClient } from "./jupiter.js";
import { USDC_MINT } from "./solana-convert.js";
import { verifySignedSwap } from "./solana-trading.js";
import { WithdrawalRejected } from "./solana-withdraw.js";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
/**
 * USDC amounts tried in turn, smallest first. Jupiter pays the network fee for wallets without
 * SOL, but only above a minimum trade size that moves with fees (about $10), and its market makers
 * sometimes fill smaller swaps. The SOL bought stays in the user's wallet.
 */
const TOP_UP_STEPS_USDC = [2_000_000n, 5_000_000n, 10_000_000n, 15_000_000n];

/**
 * Buys a little SOL with USDC so a wallet holding only tokens can pay Solana network fees, for
 * example to withdraw those tokens. Jupiter sponsors the swap's own fee, so it works from zero SOL.
 */
export class SolanaGasTopUpService {
  constructor(
    private readonly jupiter: JupiterQuoteClient,
    private readonly helius: Pick<HeliusClient, "getTokenBalance">,
  ) {}

  async prepare(input: { wallet: string; needsLamports: string }) {
    const needed = BigInt(input.needsLamports);
    const { rawBalance } = await this.helius.getTokenBalance(input.wallet, USDC_MINT).catch(() => {
      throw new WithdrawalRejected("Wallet balances are unavailable. Try again shortly.", 503);
    });
    const usdc = BigInt(rawBalance);
    for (const amount of TOP_UP_STEPS_USDC) {
      if (amount > usdc) break;
      let order: Awaited<ReturnType<JupiterQuoteClient["order"]>>;
      try {
        // No referral fee: Jupiter only sponsors gas for swaps without one.
        order = await this.jupiter.order(USDC_MINT, WRAPPED_SOL, amount.toString(), input.wallet);
      } catch (error) {
        // Too small to sponsor, or Jupiter wants SOL the wallet lacks: try a larger amount.
        if (
          error instanceof JupiterOrderError &&
          (error.belowGaslessMinimum || error.insufficientGas)
        )
          continue;
        throw new WithdrawalRejected(
          "SOL for fees can't be bought right now. Try again shortly, or add a little SOL.",
          503,
        );
      }
      if (
        order.inputMint !== USDC_MINT ||
        order.outputMint !== WRAPPED_SOL ||
        order.inAmount !== amount.toString()
      )
        throw new WithdrawalRejected("The SOL quote did not match the request. Try again.", 503);
      if (BigInt(order.outAmount) < needed) continue;
      return {
        requestId: order.requestId,
        transaction: order.transaction,
        usdcAmount: amount.toString(),
        solLamports: order.outAmount,
      };
    }
    throw new WithdrawalRejected(
      usdc < (TOP_UP_STEPS_USDC[0] ?? 0n)
        ? "Add a little SOL to your wallet for network fees. You need at least $2 of USDC for Sisera to buy it for you."
        : "Jupiter can't swap that little USDC without SOL for fees right now. Add a little SOL to your wallet, or try again with more USDC.",
    );
  }

  async execute(input: {
    wallet: string;
    requestId: string;
    transaction: string;
    signedTransaction: string;
  }) {
    try {
      verifySignedSwap(input.transaction, input.signedTransaction, input.wallet);
    } catch {
      throw new WithdrawalRejected(
        "Your wallet's signature does not match the swap you reviewed. Try again.",
      );
    }
    const result = await this.jupiter
      .execute(input.signedTransaction, input.requestId)
      .catch(() => {
        throw new WithdrawalRejected(
          "The swap could not be sent. Nothing left your wallet; try again.",
          503,
        );
      });
    if (result.status !== "Success")
      throw new WithdrawalRejected("The swap to SOL failed. Nothing left your wallet; try again.");
    return { signature: result.signature ?? null, solLamports: result.outputAmountResult ?? null };
  }
}
