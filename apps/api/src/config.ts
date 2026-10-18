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
  SISERA_LIVE_BINANCE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
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
  CLAWPUMP_API_KEY: z.string().optional(),
  RELAY_API_KEY: z.string().optional(),
  SISERA_X_BEARER_TOKEN: z.string().optional(),
  SISERA_X_TRACKED_ACCOUNTS: z.string().optional(),
  SISERA_X_MAX_DAILY_SPEND_USD: z.coerce.number().nonnegative().default(0),
  SISERA_TELEGRAM_NEWS_CHANNELS: z.string().optional(),
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
  SISERA_DISCORD_BOT_TOKEN: z.string().optional(),
  SISERA_DISCORD_CHANNEL_IDS: z.string().optional(),
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
