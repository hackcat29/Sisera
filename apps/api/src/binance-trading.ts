import { createHmac } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { TradeRejection } from "./solana-trading.js";

const Account = z.object({
  canTrade: z.boolean(),
  balances: z.array(z.object({ asset: z.string(), free: z.string() })),
});
const ExchangeInfo = z.object({
  symbols: z.array(
    z.object({
      symbol: z.string(),
      status: z.string(),
      baseAsset: z.string(),
      quoteAsset: z.string(),
      filters: z.array(z.object({ filterType: z.string() }).passthrough()),
    }),
  ),
});
const OrderResult = z.object({
  symbol: z.string(),
  orderId: z.number(),
  clientOrderId: z.string(),
  status: z.string(),
  executedQty: z.string(),
  cummulativeQuoteQty: z.string(),
  fills: z.array(z.object({ commission: z.string(), commissionAsset: z.string() })).optional(),
});

type Fetcher = typeof globalThis.fetch;

export class BinanceTradingClient {
  constructor(
    private readonly baseUrl = "https://api.binance.com",
    private readonly fetcher: Fetcher = globalThis.fetch,
  ) {}

  async placeMarketOrder(input: {
    apiKey: string;
    apiSecret: string;
    symbol: string;
    side: "buy" | "sell";
    /** Size in the base asset, or `quoteAmount` to trade an exact amount of USDT instead. */
    quantity?: string | undefined;
    quoteAmount?: string | undefined;
    indicativePrice: string;
    clientOrderId: string;
  }) {
    const [account, info] = await Promise.all([
      this.signedGet("/api/v3/account", input.apiKey, input.apiSecret, Account),
      this.getExchangeInfo(input.symbol),
    ]);
    const instrument = info.symbols.find((item) => item.symbol === input.symbol);
    if (!instrument || instrument.status !== "TRADING" || instrument.quoteAsset !== "USDT")
      throw new TradeRejection("This Binance USDT spot pair is not trading.", 422);
    if (!account.canTrade) throw new TradeRejection("This Binance API key cannot trade.", 422);
    const indicative = new Decimal(input.indicativePrice);
    const byQuote = input.quoteAmount != null;
    const notional = byQuote
      ? new Decimal(input.quoteAmount ?? "0")
      : new Decimal(input.quantity ?? "0").mul(indicative);
    const quantity = byQuote ? notional.div(indicative) : new Decimal(input.quantity ?? "0");
    if (!notional.isFinite() || !notional.gt(0) || !indicative.isFinite() || !indicative.gt(0))
      throw new TradeRejection("Enter a valid amount.", 422);
    if (notional.lt(10) || notional.gt(2500))
      throw new TradeRejection("Live orders must be between $10 and $2,500.", 422);
    const lot = instrument.filters.find((item) => item.filterType === "LOT_SIZE");
    const marketLot = instrument.filters.find((item) => item.filterType === "MARKET_LOT_SIZE");
    const selectedLot = marketLot && String(marketLot.stepSize) !== "0.00000000" ? marketLot : lot;
    // An exact USDT amount is sized by Binance itself, so only base-asset sizes need lot rules.
    if (selectedLot && !byQuote) {
      const min = new Decimal(String(selectedLot.minQty));
      const max = new Decimal(String(selectedLot.maxQty));
      const step = new Decimal(String(selectedLot.stepSize));
      if (quantity.lt(min) || quantity.gt(max) || (step.gt(0) && !quantity.mod(step).isZero()))
        throw new TradeRejection(
          `Quantity does not satisfy Binance lot size (${step.toString()}).`,
          422,
        );
    }
    const availableAsset = input.side === "buy" ? "USDT" : instrument.baseAsset;
    const free = new Decimal(
      account.balances.find((item) => item.asset === availableAsset)?.free ?? "0",
    );
    if (input.side === "buy" ? notional.gt(free) : quantity.gt(free))
      throw new TradeRejection(
        `Not enough ${availableAsset} on Binance. You have ${free.toFixed()} available.`,
        422,
      );
    const params = new URLSearchParams({
      symbol: input.symbol,
      side: input.side.toUpperCase(),
      type: "MARKET",
      ...(byQuote ? { quoteOrderQty: notional.toFixed(2) } : { quantity: input.quantity ?? "" }),
      newClientOrderId: input.clientOrderId,
      newOrderRespType: "FULL",
      recvWindow: "5000",
      timestamp: String(Date.now()),
    });
    const signature = createHmac("sha256", input.apiSecret).update(params.toString()).digest("hex");
    const url = `${this.baseUrl}/api/v3/order?${params.toString()}&signature=${signature}`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: { "X-MBX-APIKEY": input.apiKey },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new TradeRejection(
        `Binance order status is unknown. Check client order ${input.clientOrderId} on Binance before retrying.`,
        504,
      );
    }
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { msg?: string } | null;
      throw new TradeRejection(
        error?.msg ?? `Binance rejected the order (${response.status}).`,
        422,
      );
    }
    const result = OrderResult.safeParse(await response.json());
    if (!result.success)
      throw new TradeRejection(
        `Binance response is unclear. Check client order ${input.clientOrderId} before retrying.`,
        504,
      );
    const executed = new Decimal(result.data.executedQty);
    const spent = new Decimal(result.data.cummulativeQuoteQty);
    const averagePrice = executed.gt(0) ? spent.div(executed) : null;
    // Commission is charged in USDT, the base asset, or BNB; BNB is valued at the standard rate.
    const feeUsd = (result.data.fills ?? []).reduce((sum, fill) => {
      const commission = new Decimal(fill.commission);
      if (fill.commissionAsset === "USDT") return sum.plus(commission);
      if (fill.commissionAsset === instrument.baseAsset && averagePrice)
        return sum.plus(commission.mul(averagePrice));
      return sum.plus(spent.mul("0.00075").div(result.data.fills?.length ?? 1));
    }, new Decimal(0));
    return {
      ...result.data,
      averagePrice: averagePrice?.toFixed() ?? null,
      feeUsd: feeUsd.toFixed(),
    };
  }

  private async getExchangeInfo(symbol: string) {
    const response = await this.fetcher(
      `${this.baseUrl}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new TradeRejection("Binance exchange rules are unavailable.", 503);
    return ExchangeInfo.parse(await response.json());
  }

  private async signedGet<T>(
    path: string,
    apiKey: string,
    apiSecret: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const params = new URLSearchParams({ recvWindow: "5000", timestamp: String(Date.now()) });
    const signature = createHmac("sha256", apiSecret).update(params.toString()).digest("hex");
    const response = await this.fetcher(
      `${this.baseUrl}${path}?${params.toString()}&signature=${signature}`,
      {
        headers: { "X-MBX-APIKEY": apiKey },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      throw new TradeRejection(
        "Binance key or account check failed.",
        response.status === 401 ? 401 : 422,
      );
    return schema.parse(await response.json());
  }
}
