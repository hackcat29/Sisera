import { z } from "zod";
import { EVM_SWAP_CHAINS, NATIVE_TOKEN } from "./evm-assets.js";

export const SOLANA_CHAIN_ID = 792703809;
export const BRIDGE_CHAINS = {
  1: { name: "Ethereum", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  8453: { name: "Base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54dA02913" },
  42161: { name: "Arbitrum", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
} as const;
export const DESTINATION_USDC = {
  999: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
  [SOLANA_CHAIN_ID]: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;
export const HYPEREVM_USDC = DESTINATION_USDC[999];
const EvmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const SolanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

function validRecipient(
  value: { destinationChainId: number; recipient: string },
  context: z.RefinementCtx,
) {
  const valid =
    value.destinationChainId === SOLANA_CHAIN_ID
      ? SolanaAddress.safeParse(value.recipient).success
      : EvmAddress.safeParse(value.recipient).success;
  if (!valid)
    context.addIssue({
      code: "custom",
      path: ["recipient"],
      message: "Invalid destination wallet",
    });
}

export const BridgeQuoteInput = z
  .object({
    originChainId: z.coerce
      .number()
      .int()
      .refine((id) => id in BRIDGE_CHAINS),
    destinationChainId: z.coerce
      .number()
      .int()
      .refine((id) => id in DESTINATION_USDC),
    user: EvmAddress,
    recipient: z.string(),
    amountUsdc: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
  })
  .superRefine((value, context) => {
    validRecipient(value, context);
    const amount = Number(value.amountUsdc);
    if (!Number.isFinite(amount) || amount < 5 || amount > 10_000)
      context.addIssue({
        code: "custom",
        path: ["amountUsdc"],
        message: "Amount must be $5–$10,000",
      });
  });

/** Any token on a supported EVM chain, swapped into USDC where Sisera trades. */
export const EvmSwapQuoteInput = z
  .object({
    originChainId: z.coerce
      .number()
      .int()
      .refine((id) => id in EVM_SWAP_CHAINS),
    destinationChainId: z.coerce
      .number()
      .int()
      .refine((id) => id in DESTINATION_USDC),
    originCurrency: EvmAddress.transform((address) => address.toLowerCase()),
    amount: z.string().regex(/^[1-9]\d{0,40}$/),
    user: EvmAddress,
    recipient: z.string(),
  })
  .superRefine((value, context) => {
    validRecipient(value, context);
    if (
      value.destinationChainId === value.originChainId &&
      value.originCurrency === EVM_SWAP_CHAINS[value.originChainId]?.usdc
    )
      context.addIssue({
        code: "custom",
        path: ["originCurrency"],
        message: "This balance is already USDC on that chain.",
      });
  });

const Transaction = z.object({
  from: EvmAddress,
  to: EvmAddress,
  data: z.string().regex(/^0x[a-fA-F0-9]*$/),
  value: z.string().regex(/^\d+$/),
  chainId: z.number().int(),
});
const CurrencyAmount = z.object({
  amount: z.string().regex(/^\d+$/),
  amountUsd: z.string().optional(),
  minimumAmount: z.string().regex(/^\d+$/).optional(),
  currency: z.object({
    chainId: z.number().int().optional(),
    address: z.string(),
    symbol: z.string().optional(),
    decimals: z.number().int(),
  }),
});
const Impact = z.object({ usd: z.string().optional(), percent: z.string().optional() });
const Quote = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().optional(),
        kind: z.string(),
        requestId: z.string().optional(),
        items: z.array(z.object({ data: Transaction })).default([]),
      }),
    )
    .min(1),
  fees: z.record(z.unknown()).optional(),
  details: z.object({
    timeEstimate: z.number().optional(),
    currencyIn: CurrencyAmount.optional(),
    currencyOut: CurrencyAmount,
    swapImpact: Impact.optional(),
    totalImpact: Impact.optional(),
  }),
});
type Quote = z.infer<typeof Quote>;
const GasFee = z.object({
  amount: z.string().regex(/^\d+$/),
  currency: z.object({ chainId: z.number().int().optional(), address: z.string() }),
});

/** Largest acceptable price impact on the swap itself, before fees. */
const MAX_SWAP_IMPACT_PCT = 2;
/** Largest acceptable loss including fees; small swaps on busy chains can be eaten by gas. */
const MAX_TOTAL_IMPACT_PCT = 10;

export class BridgeUnavailable extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}

const formatUsdc = (atomic: bigint) =>
  `${atomic / 1_000_000n}.${(atomic % 1_000_000n).toString().padStart(6, "0")}`;
const percent = (impact: z.infer<typeof Impact> | undefined) => {
  const value = Number(impact?.percent);
  return impact?.percent != null && Number.isFinite(value) ? value : null;
};

export class RelayBridgeClient {
  constructor(private readonly apiKey?: string) {}

  private async request(body: Record<string, unknown>): Promise<Quote> {
    const response = await fetch("https://api.relay.link/quote/v2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
      },
      body: JSON.stringify({ ...body, tradeType: "EXACT_INPUT", usePermit: false }),
      signal: AbortSignal.timeout(12000),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = z.object({ message: z.string() }).safeParse(payload);
      throw new BridgeUnavailable(
        message.success ? message.data.message : "Relay could not quote this route.",
        response.status < 500 ? 422 : 503,
      );
    }
    const quote = Quote.safeParse(payload);
    if (!quote.success) throw new BridgeUnavailable("Relay returned unsupported bridge steps.");
    return quote.data;
  }

  /** Relay steps with nothing to send are skipped; everything else must be signed by `user`. */
  private executableSteps(quote: Quote, originChainId: number, user: string) {
    const steps = quote.steps.filter((step) => step.items.length > 0);
    if (
      !steps.length ||
      steps.some(
        (step) =>
          step.kind !== "transaction" ||
          step.items.some(
            (item) =>
              item.data.chainId !== originChainId ||
              item.data.from.toLowerCase() !== user.toLowerCase(),
          ),
      )
    )
      throw new BridgeUnavailable(
        "This bridge route needs wallet actions Sisera cannot sign yet.",
        422,
      );
    const requestId = quote.steps.find((step) =>
      /^0x[a-fA-F0-9]{64}$/.test(step.requestId ?? ""),
    )?.requestId;
    if (!requestId)
      throw new BridgeUnavailable("Relay did not provide a trackable bridge request.");
    return {
      requestId,
      steps: steps.map((step) => ({
        id: step.id ?? null,
        kind: step.kind,
        items: step.items.map((item) => item.data),
      })),
    };
  }

  private checkOutput(quote: Quote, destinationChainId: number) {
    const destination = DESTINATION_USDC[destinationChainId as keyof typeof DESTINATION_USDC];
    const actualOutputMint = quote.details.currencyOut.currency.address;
    const correctOutputMint =
      destinationChainId === SOLANA_CHAIN_ID
        ? actualOutputMint === destination
        : actualOutputMint.toLowerCase() === destination.toLowerCase();
    if (quote.details.currencyOut.currency.decimals !== 6 || !correctOutputMint)
      throw new BridgeUnavailable("Relay returned an unexpected destination token.");
    return BigInt(quote.details.currencyOut.amount);
  }

  async quote(rawInput: unknown) {
    const input = BridgeQuoteInput.parse(rawInput);
    const origin = BRIDGE_CHAINS[input.originChainId as keyof typeof BRIDGE_CHAINS];
    const destination = DESTINATION_USDC[input.destinationChainId as keyof typeof DESTINATION_USDC];
    const [whole, fraction = ""] = input.amountUsdc.split(".");
    const amount = (BigInt(whole ?? "0") * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString();
    const quote = await this.request({
      user: input.user,
      recipient: input.recipient,
      originChainId: input.originChainId,
      destinationChainId: input.destinationChainId,
      originCurrency: origin.usdc,
      destinationCurrency: destination,
      amount,
    });
    const outputAtomic = this.checkOutput(quote, input.destinationChainId);
    const { requestId, steps } = this.executableSteps(quote, input.originChainId, input.user);
    return {
      requestId,
      steps,
      fees: quote.fees ?? {},
      outputAmountUsdc: formatUsdc(outputAtomic),
      timeEstimateSeconds: quote.details.timeEstimate ?? null,
      originChainId: input.originChainId,
      destinationChainId: input.destinationChainId,
      originAmountUsdc: input.amountUsdc,
      recipient: input.recipient,
    };
  }

  /**
   * Quotes any token on a supported EVM chain into USDC on Solana or HyperEVM. Relay routes the
   * origin-chain swap through DEX aggregators and delivers USDC in one signed flow; an ERC-20 adds
   * an approval transaction before the swap.
   */
  async swapQuote(rawInput: unknown) {
    const input = EvmSwapQuoteInput.parse(rawInput);
    const destination = DESTINATION_USDC[input.destinationChainId as keyof typeof DESTINATION_USDC];
    const quote = await this.request({
      user: input.user,
      recipient: input.recipient,
      refundTo: input.user,
      originChainId: input.originChainId,
      destinationChainId: input.destinationChainId,
      originCurrency: input.originCurrency,
      destinationCurrency: destination,
      amount: input.amount,
    });
    const outputAtomic = this.checkOutput(quote, input.destinationChainId);
    const currencyIn = quote.details.currencyIn;
    if (
      !currencyIn ||
      currencyIn.currency.address.toLowerCase() !== input.originCurrency ||
      currencyIn.amount !== input.amount
    )
      throw new BridgeUnavailable("Relay quoted a different token or amount.");
    const swapImpact = percent(quote.details.swapImpact);
    const totalImpact = percent(quote.details.totalImpact);
    if (swapImpact != null && swapImpact < -MAX_SWAP_IMPACT_PCT)
      throw new BridgeUnavailable(
        "This swap would move the price more than 2%. Try a smaller amount.",
        422,
      );
    if (totalImpact != null && totalImpact < -MAX_TOTAL_IMPACT_PCT)
      throw new BridgeUnavailable(
        "Fees would take more than 10% of this swap. Swap a larger amount.",
        422,
      );
    const { requestId, steps } = this.executableSteps(quote, input.originChainId, input.user);
    const gas = GasFee.safeParse(quote.fees?.gas);
    const minimum = quote.details.currencyOut.minimumAmount;
    return {
      requestId,
      steps,
      fees: quote.fees ?? {},
      outputAmountUsdc: formatUsdc(outputAtomic),
      minimumOutputUsdc: minimum ? formatUsdc(BigInt(minimum)) : null,
      timeEstimateSeconds: quote.details.timeEstimate ?? null,
      originChainId: input.originChainId,
      destinationChainId: input.destinationChainId,
      originCurrency: input.originCurrency,
      originSymbol: currencyIn.currency.symbol ?? null,
      originDecimals: currencyIn.currency.decimals,
      originAmount: input.amount,
      originAmountUsd: currencyIn.amountUsd ?? null,
      recipient: input.recipient,
      user: input.user,
      swapImpactPct: swapImpact,
      totalImpactPct: totalImpact,
      /** Origin-chain gas Relay expects the user to pay, in the native token's smallest unit. */
      originGasRaw:
        gas.success &&
        gas.data.currency.address.toLowerCase() === NATIVE_TOKEN &&
        (gas.data.currency.chainId ?? input.originChainId) === input.originChainId
          ? gas.data.amount
          : null,
    };
  }

  async status(requestId: string) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(requestId))
      throw new BridgeUnavailable("Invalid bridge request ID.", 400);
    const url = new URL("https://api.relay.link/intents/status/v3");
    url.searchParams.set("requestId", requestId);
    const response = await fetch(url, {
      headers: this.apiKey ? { "x-api-key": this.apiKey } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new BridgeUnavailable("Bridge status is unavailable.");
    return z
      .object({
        status: z.string().min(1).max(64),
        inTxHashes: z.array(z.string().regex(/^0x[a-fA-F0-9]{64}$/)).optional(),
        txHashes: z.array(z.string().regex(/^0x[a-fA-F0-9]{64}$/)).optional(),
      })
      .parse(await response.json());
  }
}
