import { z } from "zod";

const Quote = z
  .object({
    inputMint: z.string(),
    outputMint: z.string(),
    inAmount: z.string(),
    outAmount: z.string(),
    otherAmountThreshold: z.string().optional(),
    /** Price impact in percentage points; `priceImpactPct` is its deprecated decimal form. */
    priceImpact: z.number().nullable().optional(),
    priceImpactPct: z.string().nullable().optional(),
    inUsdValue: z.number().nullable().optional(),
    outUsdValue: z.number().nullable().optional(),
    slippageBps: z.number().int().optional(),
    feeBps: z.number().optional(),
    gasless: z.boolean().optional(),
    signatureFeePayer: z.string().nullable().optional(),
    router: z.string(),
    requestId: z.string(),
    transaction: z.string().nullable().optional(),
    errorCode: z.number().int().optional(),
    errorMessage: z.string().optional(),
  })
  .passthrough();
type Quote = z.infer<typeof Quote>;

/** Jupiter could quote the swap but would not build a transaction for this taker. */
export class JupiterOrderError extends Error {
  constructor(
    message: string,
    readonly router: string | null,
    readonly errorCode: number | null,
  ) {
    super(message);
  }

  /** Metis, DFlow and OKX report 2 when the taker cannot pay network fees. */
  get insufficientGas() {
    return this.router !== "jupiterz" && this.errorCode === 2;
  }

  /** The swap is too small for Jupiter to sponsor network fees. */
  get belowGaslessMinimum() {
    return this.router !== "jupiterz" && this.errorCode === 3;
  }

  get insufficientFunds() {
    return this.errorCode === 1;
  }
}

/** Price impact as a positive decimal fraction (0.01 = 1%), or null when Jupiter omits it. */
export function priceImpactFraction(quote: Pick<Quote, "priceImpact" | "priceImpactPct">) {
  if (quote.priceImpact != null && Number.isFinite(quote.priceImpact))
    return Math.abs(quote.priceImpact) / 100;
  const legacy = Number(quote.priceImpactPct);
  return quote.priceImpactPct != null && Number.isFinite(legacy) ? Math.abs(legacy) : null;
}

export class JupiterQuoteClient {
  constructor(private readonly apiKey: string) {}

  async preview(inputMint: string, outputMint: string, amount: string) {
    const url = new URL("https://api.jup.ag/swap/v2/order");
    url.search = new URLSearchParams({ inputMint, outputMint, amount }).toString();
    const response = await fetch(url, {
      headers: { "x-api-key": this.apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Jupiter quote returned ${response.status}`);
    const quote = Quote.parse(await response.json());
    if (quote.transaction != null)
      throw new Error("Jupiter returned a transaction for a quote-only request");
    return {
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      priceImpactPct: quote.priceImpactPct ?? null,
      /** Price impact as a decimal fraction (0.01 = 1%). */
      priceImpactFraction: priceImpactFraction(quote),
      router: quote.router,
      requestId: quote.requestId,
      executable: false as const,
    };
  }

  /**
   * Builds an executable order for `taker`. Without `slippageBps`, Jupiter's real-time slippage
   * estimator chooses the tolerance, which keeps every router eligible.
   */
  async order(
    inputMint: string,
    outputMint: string,
    amount: string,
    taker: string,
    slippageBps?: number,
  ) {
    const url = new URL("https://api.jup.ag/swap/v2/order");
    const search = new URLSearchParams({ inputMint, outputMint, amount, taker });
    if (slippageBps != null)
      search.set("slippageBps", String(Math.max(1, Math.min(500, Math.round(slippageBps)))));
    url.search = search.toString();
    const response = await fetch(url, {
      headers: { "x-api-key": this.apiKey },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Jupiter order returned ${response.status}`);
    const order = Quote.parse(await response.json());
    if (!order.transaction)
      throw new JupiterOrderError(
        order.errorMessage ?? "Jupiter could not build this trade",
        order.router ?? null,
        order.errorCode ?? null,
      );
    return {
      ...order,
      transaction: order.transaction,
      gasless:
        order.gasless ?? (order.signatureFeePayer != null && order.signatureFeePayer !== taker),
    };
  }

  async execute(signedTransaction: string, requestId: string) {
    const response = await fetch("https://api.jup.ag/swap/v2/execute", {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ signedTransaction, requestId }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`Jupiter execution returned ${response.status}`);
    return z
      .object({
        status: z.enum(["Success", "Failed"]),
        signature: z.string().optional(),
        error: z.string().optional(),
        inputAmountResult: z.string().optional(),
        outputAmountResult: z.string().optional(),
      })
      .parse(await response.json());
  }
}
