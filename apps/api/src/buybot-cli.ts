import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { readConfig } from "./config.js";
import { HeliusClient } from "./helius.js";
import {
  SISERA_MINT,
  SiseraTelegramBuyBot,
  extractSiseraBuy,
  formatSiseraBuyMessage,
  formatSiseraStatsMessage,
} from "./telegram-buybot.js";

const rootDir = resolve(import.meta.dirname, "../../..");
const envPath = resolve(rootDir, ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const mode = (process.argv[2] ?? "watch").toLowerCase();
const config = readConfig(process.env);

const solanaRpcUrl =
  config.SOLANA_RPC_URL ??
  (config.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com");

const helius = new HeliusClient(solanaRpcUrl);
const mediaPath = resolve(rootDir, "stickers", "01-bullish.png");

async function discoverChatIds() {
  if (!config.SISERA_TELEGRAM_BOT_TOKEN) {
    console.error(
      "[buybot] SISERA_TELEGRAM_BOT_TOKEN is not set in .env.\n" +
        "1. Message @BotFather on Telegram and run /newbot\n" +
        "2. Copy the token into .env as SISERA_TELEGRAM_BOT_TOKEN=<token>\n" +
        "3. Add your bot to your Sisera Telegram group and send a message in the group\n" +
        "4. Re-run: pnpm buybot:chatid",
    );
    process.exit(1);
  }

  const baseUrl = `https://api.telegram.org/bot${config.SISERA_TELEGRAM_BOT_TOKEN}`;
  const meRes = await fetch(`${baseUrl}/getMe`);
  if (!meRes.ok) {
    console.error(
      `[buybot] Telegram getMe failed (${meRes.status}). Check your SISERA_TELEGRAM_BOT_TOKEN.`,
    );
    process.exit(1);
  }
  const me = (await meRes.json()) as { result?: { username?: string; first_name?: string } };
  console.log(
    `[buybot] Connected to Telegram Bot: @${me.result?.username ?? "unknown"} (${me.result?.first_name ?? ""})`,
  );

  const updatesRes = await fetch(`${baseUrl}/getUpdates?limit=50`);
  const updatesData = (await updatesRes.json()) as {
    result?: Array<{
      message?: { chat?: { id: number; title?: string; username?: string; type: string } };
      my_chat_member?: { chat?: { id: number; title?: string; username?: string; type: string } };
      channel_post?: { chat?: { id: number; title?: string; username?: string; type: string } };
    }>;
  };

  const chats = new Map<number, { title: string; type: string }>();
  for (const item of updatesData.result ?? []) {
    const chat = item.message?.chat ?? item.my_chat_member?.chat ?? item.channel_post?.chat;
    if (chat) {
      chats.set(chat.id, {
        title: chat.title ?? chat.username ?? "Direct Message",
        type: chat.type,
      });
    }
  }

  if (chats.size === 0) {
    console.log(
      "\n[buybot] No recent group messages found yet.\n" +
        "👉 Add the bot to your Telegram group and send any message (e.g. /start or hello), then run `pnpm buybot:chatid` again.",
    );
    return;
  }

  console.log("\n[buybot] Discovered Telegram Chats:");
  for (const [id, info] of chats.entries()) {
    console.log(`  • ${info.title} (${info.type}) -> SISERA_TELEGRAM_CHAT_ID=${id}`);
  }
}

async function runPreviewOrTest() {
  if (!config.HELIUS_API_KEY) {
    console.error(
      "[buybot] HELIUS_API_KEY is required in .env to fetch on-chain $SISERA transactions.",
    );
    process.exit(1);
  }

  const bot = new SiseraTelegramBuyBot({
    botToken: config.SISERA_TELEGRAM_BOT_TOKEN ?? "",
    chatId: config.SISERA_TELEGRAM_CHAT_ID ?? "",
    heliusApiKey: config.HELIUS_API_KEY,
    mint: config.SISERA_BUYBOT_MINT ?? SISERA_MINT,
    minUsd: config.SISERA_BUYBOT_MIN_USD,
    pollIntervalMs: config.SISERA_BUYBOT_POLL_INTERVAL_MS,
    terminalUrl: config.SISERA_PUBLIC_URL,
    mediaPath,
    heliusClient: helius,
  });

  const snapshot = await bot.getMarketSnapshot(true);
  console.log("\n=== LIVE $SISERA MARKET STATS CARD ===\n");
  console.log(formatSiseraStatsMessage(snapshot, config.SISERA_BUYBOT_MINT));

  const txs = await bot.fetchRecentTransactions(25);
  let latestBuy = null;
  for (const tx of txs) {
    const extracted = extractSiseraBuy(
      tx,
      config.SISERA_BUYBOT_MINT,
      new Set(snapshot.pairAddresses),
    );
    if (extracted) {
      latestBuy = extracted;
      break;
    }
  }

  if (latestBuy) {
    const holderInfo = await bot.getBuyerHolderInfo(latestBuy.buyer, latestBuy.tokenAmount);
    const html = formatSiseraBuyMessage(latestBuy, snapshot, holderInfo);
    console.log("\n=== LATEST ON-CHAIN $SISERA BUY ALERT PREVIEW ===\n");
    console.log(html);
  }

  if (config.SISERA_TELEGRAM_BOT_TOKEN && config.SISERA_TELEGRAM_CHAT_ID) {
    const result = await bot.sendLatestRealBuyPreview();
    console.log(
      `\n✅ Sent live $SISERA buy alert (tx: ${result.buy.signature.slice(0, 12)}...) to Telegram chat ${config.SISERA_TELEGRAM_CHAT_ID}!`,
    );
  } else {
    console.log(
      "\nℹ️  Set SISERA_TELEGRAM_BOT_TOKEN and SISERA_TELEGRAM_CHAT_ID in .env and re-run `pnpm buybot:test` to post this alert directly to your Telegram group.",
    );
  }
}

async function runWatchDaemon() {
  if (!config.SISERA_TELEGRAM_BOT_TOKEN || !config.SISERA_TELEGRAM_CHAT_ID) {
    console.error(
      "[buybot] Missing SISERA_TELEGRAM_BOT_TOKEN or SISERA_TELEGRAM_CHAT_ID in .env.\n" +
        "Run `pnpm buybot:test` to preview live on-chain alerts in your terminal, or configure both variables in .env.",
    );
    process.exit(1);
  }
  if (!config.HELIUS_API_KEY) {
    console.error("[buybot] Missing HELIUS_API_KEY in .env.");
    process.exit(1);
  }

  const bot = new SiseraTelegramBuyBot({
    botToken: config.SISERA_TELEGRAM_BOT_TOKEN,
    chatId: config.SISERA_TELEGRAM_CHAT_ID,
    heliusApiKey: config.HELIUS_API_KEY,
    mint: config.SISERA_BUYBOT_MINT,
    minUsd: config.SISERA_BUYBOT_MIN_USD,
    pollIntervalMs: config.SISERA_BUYBOT_POLL_INTERVAL_MS,
    terminalUrl: config.SISERA_PUBLIC_URL,
    mediaPath,
    heliusClient: helius,
    logger: {
      info: (obj, msg) => console.log(`[buybot] ${msg ?? ""}`, obj),
      warn: (obj, msg) => console.warn(`[buybot] ${msg ?? ""}`, obj),
      error: (obj, msg) => console.error(`[buybot] ${msg ?? ""}`, obj),
    },
  });

  await bot.start();
  console.log(
    `[buybot] Watching $SISERA (${config.SISERA_BUYBOT_MINT}) every ${config.SISERA_BUYBOT_POLL_INTERVAL_MS}ms (min buy: $${config.SISERA_BUYBOT_MIN_USD})...`,
  );

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`\n[buybot] Stopping (${sig})...`);
      bot.stop();
      process.exit(0);
    });
  }
}

if (mode === "chatid") {
  await discoverChatIds();
} else if (mode === "test" || mode === "preview") {
  await runPreviewOrTest();
} else {
  await runWatchDaemon();
}
