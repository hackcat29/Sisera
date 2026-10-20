import { z } from "zod";

const Environment = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  SISERA_LIVE_SOLANA_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SISERA_LIVE_PREDICTIONS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SISERA_LIVE_HYPERLIQUID_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** Highest leverage Sisera allows on a perpetual order, and on the account as a whole. */
  SISERA_PERP_MAX_LEVERAGE: z.coerce.number().int().min(1).max(50).default(20),
  /** Largest position size a single perpetual order may open, in USD. */
  SISERA_PERP_MAX_NOTIONAL_USD: z.coerce.number().positive().max(10_000_000).default(25_000),
  /**
   * Wallet that receives Hyperliquid builder fees. Hyperliquid only pays builders holding at least
   * 100 USDC in their perps account. Without it, orders carry no builder fee.
   */
  SISERA_BUILDER_ADDRESS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
  ),
  /** Builder fee in basis points; Hyperliquid caps it at 10 (0.1%) on perps and 100 (1%) on spot. */
  SISERA_BUILDER_FEE_PERP_BPS: z.coerce.number().min(0).max(10).default(10),
  SISERA_BUILDER_FEE_SPOT_BPS: z.coerce.number().min(0).max(100).default(100),
  /** Jupiter referral account that collects Sisera's fee on Solana trades. */
  SISERA_JUPITER_REFERRAL_ACCOUNT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .optional(),
  ),
  /** Jupiter accepts 50-255 basis points; 0 turns the fee off. */
  SISERA_JUPITER_TRADE_FEE_BPS: z.coerce
    .number()
    .int()
    .refine((value) => value === 0 || (value >= 50 && value <= 255))
    .default(100),
  SISERA_JUPITER_CONVERT_FEE_BPS: z.coerce
    .number()
    .int()
    .refine((value) => value === 0 || (value >= 50 && value <= 255))
    .default(50),
  /** EVM address whose Relay balance collects Sisera's fee on bridges and EVM swaps. */
  SISERA_RELAY_FEE_RECIPIENT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
  ),
  SISERA_RELAY_SWAP_FEE_BPS: z.coerce.number().int().min(0).max(500).default(50),
  /** Sisera's USDC token account on Solana, which receives fees on prediction orders. */
  SISERA_SOLANA_FEE_ACCOUNT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .optional(),
  ),
  SISERA_PREDICTION_FEE_BPS: z.coerce.number().min(0).max(500).default(100),
  /** Moving USDC between chains to fund trading is free by default. */
  SISERA_RELAY_BRIDGE_FEE_BPS: z.coerce.number().int().min(0).max(500).default(0),
  SISERA_LIVE_LAUNCHES_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SISERA_LIVE_AGENTS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SISERA_DELEGATED_SIGNING_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SISERA_SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SISERA_ALLOW_DEV_AUTH: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BINANCE_SPOT_BASE_URL: z.string().url().default("https://data-api.binance.vision"),
  HYPERLIQUID_BASE_URL: z.string().url().default("https://api.hyperliquid.xyz"),
  PANTA_API_BASE_URL: z.string().url().default("https://live-api.panta.market/api/v1"),
  PANTA_API_KEY: z.string().optional(),
  PANTA_PROGRAM_ID: z.string().default("6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp"),
  JUPITER_PREDICTION_BASE_URL: z.string().url().default("https://live-api.panta.market/api/v1"),
  PRESTOCKS_BASE_URL: z.string().url().default("https://prestocks.com"),
  PYTH_API_KEY: z.string().optional(),
  PYTH_HERMES_URL: z.string().url().default("https://pyth.dourolabs.app/hermes"),
  COINMARKETCAP_API_KEY: z.string().optional(),
  HELIUS_API_KEY: z.string().optional(),
  HELIUS_WEBHOOK_SECRET: z.string().optional(),
  SOLANA_RPC_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),
  JUPITER_API_KEY: z.string().optional(),
  /** Largest single swap into USDC, measured by the USDC it returns. */
  SISERA_SWAP_MAX_USD: z.coerce.number().positive().max(1_000_000).default(10_000),
  /** Private RPCs for EVM swap balances, as `chainId=url` pairs separated by commas. */
  SISERA_EVM_RPC_URLS: z
    .string()
    .optional()
    .transform((value, context) => {
      const urls: Record<number, string> = {};
      for (const pair of (value ?? "").split(",").filter((item) => item.trim())) {
        const [id, ...rest] = pair.trim().split("=");
        const url = rest.join("=");
        if (!/^\d+$/.test(id ?? "") || !z.string().url().safeParse(url).success) {
          context.addIssue({
            code: "custom",
            message: "Use chainId=url pairs separated by commas",
          });
          return z.NEVER;
        }
        urls[Number(id)] = url;
      }
      return urls;
    }),
  CLAWPUMP_API_KEY: z.string().optional(),
  RELAY_API_KEY: z.string().optional(),
  SISERA_TELEGRAM_BOT_TOKEN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional(),
  ),
  SISERA_TELEGRAM_CHAT_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional(),
  ),
  // Runs the buybot inside the API process. Leave false when running `pnpm buybot`, or every buy posts twice.
  SISERA_BUYBOT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SISERA_BUYBOT_MINT: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .default("4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5"),
  SISERA_BUYBOT_MIN_USD: z.coerce.number().nonnegative().default(2),
  SISERA_BUYBOT_POLL_INTERVAL_MS: z.coerce.number().int().min(2000).default(10000),
  GNEWS_API_KEY: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),
  MARKETAUX_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  PRIVY_AUTHORIZATION_PRIVATE_KEY: z.string().optional(),
  SEC_EDGAR_USER_AGENT: z.string().default("Sisera market intelligence https://sisera.xyz"),
  SISERA_PUBLIC_URL: z.string().url().default("https://sisera.xyz"),
  /** Optional partner wallet that receives Meteora DBC partner fees for launches made in Sisera. */
  SISERA_DBC_PARTNER_WALLET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .optional(),
  ),
  SISERA_INTELLIGENCE_MODEL: z.string().optional(),
});

export type ApiConfig = z.infer<typeof Environment>;

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  // The research model was first configured under SISERA_OPENROUTER_* names; accept either.
  return Environment.parse({
    ...environment,
    OPENROUTER_API_KEY: environment.OPENROUTER_API_KEY || environment.SISERA_OPENROUTER_API_KEY,
    SISERA_INTELLIGENCE_MODEL:
      environment.SISERA_INTELLIGENCE_MODEL || environment.SISERA_OPENROUTER_MODEL,
  });
}
