export const agentTemplates = [
  {
    id: "trend-confirmation-v1",
    name: "Trend Confirmation",
    description: "Follows liquid BTC, ETH and SOL trends only when volume confirms the move.",
    universe: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    timeframe: "1h",
    factors: [
      "EMA 12/26 crossover",
      "20-candle relative volume above 1.2",
      "ATR volatility filter",
    ],
    risk: "Risk at most 0.5% of allocated capital per idea; abstain on stale candles.",
    rules: {
      entry: [
        { type: "ema_trend", fast: 12, slow: 26, direction: "bullish", requireCross: true },
        { type: "relative_volume_above", lookback: 20, ratio: 1.2 },
      ],
      exit: [{ type: "ema_trend", fast: 12, slow: 26, direction: "bearish", requireCross: false }],
    },
  },
  {
    id: "funding-dislocation-v1",
    name: "Funding Dislocation",
    description:
      "Looks for crowded perpetual positioning and requires a confirming price reversal.",
    universe: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    timeframe: "4h",
    factors: ["Hyperliquid funding percentile", "mark versus oracle divergence", "RSI reversal"],
    risk: "Research only until funding history and execution shortfall pass backtest and stress gates.",
    rules: null,
  },
  {
    id: "spot-breakout-v1",
    name: "Spot Breakout",
    description: "Screens spot assets for a 20-period high with sufficient book depth.",
    universe: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"],
    timeframe: "1h",
    factors: ["20-period high", "relative volume", "spread and depth gate"],
    risk: "No leverage; reject wide spreads and stale order books.",
    rules: {
      entry: [
        { type: "breakout_high", lookback: 20 },
        { type: "relative_volume_above", lookback: 20, ratio: 1.2 },
      ],
      exit: [{ type: "close_below_sma", period: 20 }],
    },
  },
  {
    id: "private-market-value-v1",
    name: "Private Market Value Gap",
    description:
      "Ranks PreStocks token prices against issuer marks, with liquidity and news checks.",
    universe: ["OPENAI", "ANTHROPIC", "SPACEX"],
    timeframe: "1d",
    factors: ["token versus issuer mark", "liquidity availability", "recent company news"],
    risk: "Issuer marks are not fair value and have no history, so these rules are enforced live only and cannot pass a historical backtest.",
    rules: {
      entry: [
        { type: "premium_below", pct: -5 },
        { type: "liquidity_above", usd: 50_000 },
        { type: "no_negative_event", minSeverity: "high", lookbackHours: 72, includeRumors: true },
      ],
      exit: [{ type: "premium_above", pct: 2 }],
    },
  },
  {
    id: "prediction-evidence-v1",
    name: "Prediction Evidence",
    description: "Reviews Panta YES/NO prices, time to resolution and stated resolution sources.",
    universe: ["panta-prediction:*", "jupiter-prediction:*"],
    timeframe: "event",
    factors: ["outcome price gap", "time to close", "resolution criteria review"],
    risk: "Prices are not calibrated probabilities; no trade proposal without verified resolution rules.",
    rules: null,
  },
  {
    id: "tokenized-equity-trend-v1",
    name: "Tokenized Equity Trend",
    description:
      "Daily trend following on liquid xStocks; backtested on the underlying share's five-year history.",
    universe: ["NVDAx", "AAPLx", "TSLAx"],
    timeframe: "1d",
    factors: ["EMA 20/50 trend", "RSI 14 above 50", "exit on bearish trend"],
    risk: "The token trades 24/7 but the backtest uses exchange sessions; weekend gaps are covered by stress tests.",
    rules: {
      entry: [
        { type: "ema_trend", fast: 20, slow: 50, direction: "bullish", requireCross: false },
        { type: "rsi_above", period: 14, value: 50 },
      ],
      exit: [{ type: "ema_trend", fast: 20, slow: 50, direction: "bearish", requireCross: false }],
    },
  },
] as const;
