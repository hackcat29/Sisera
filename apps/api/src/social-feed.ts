import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

export type SocialPost = {
  id: string;
  platform: "x" | "telegram" | "reddit" | "discord";
  community: string;
  text: string;
  url: string;
  publishedAt: string;
};

const RedditFeed = z.object({
  feed: z.object({ entry: z.union([z.array(z.unknown()), z.unknown()]).optional() }),
});
const RedditEntry = z.object({
  title: z.string(),
  updated: z.string(),
  link: z.object({ "@_href": z.string().url() }),
  id: z.string(),
});
const XSearch = z.object({
  data: z
    .array(
      z.object({ id: z.string(), text: z.string(), created_at: z.string(), author_id: z.string() }),
    )
    .default([]),
  includes: z
    .object({ users: z.array(z.object({ id: z.string(), username: z.string() })).optional() })
    .optional(),
});
const redditCommunities = ["CryptoCurrency", "Bitcoin", "ethereum", "solana", "Hyperliquid"];
const defaultTelegram = ["cointelegraph", "decryptmedia", "WuBlockchain"];
const defaultX = ["CoinDesk", "TheBlock__", "solana", "ethereum", "HyperliquidX"];

function decodeHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const codepoint = Number(decimal);
      return codepoint >= 32 && codepoint <= 0x10ffff ? String.fromCodePoint(codepoint) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const codepoint = Number.parseInt(hex, 16);
      return codepoint >= 32 && codepoint <= 0x10ffff ? String.fromCodePoint(codepoint) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

export class SocialFeedClient {
  private cache: { until: number; posts: SocialPost[]; sources: Record<string, string> } | null =
    null;
  private xLastFetch = 0;
  private xPosts: SocialPost[] = [];
  constructor(
    private readonly config: {
      xBearer?: string | undefined;
      xAccounts?: string | undefined;
      xDailyBudget?: number | undefined;
      telegramChannels?: string | undefined;
      discordBotToken?: string | undefined;
      discordChannelIds?: string | undefined;
    },
  ) {}

  async list() {
    if (this.cache && this.cache.until > Date.now()) return this.cache;
    const tasks = [
      ...redditCommunities.map((community) => ({
        platform: "reddit",
        name: community,
        run: () => this.reddit(community),
      })),
      ...(
        this.config.telegramChannels
          ?.split(",")
          .map((name) => name.trim().replace(/^@/, ""))
          .filter((name) => /^[A-Za-z0-9_]{5,32}$/.test(name))
          .slice(0, 8) ?? defaultTelegram
      ).map((name) => ({ platform: "telegram", name, run: () => this.telegram(name) })),
    ];
    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    const posts = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    const sources: Record<string, string> = {};
    results.forEach((result, index) => {
      const task = tasks[index];
      if (task)
        sources[`${task.platform}:${task.name}`] =
          result.status === "fulfilled" ? "live" : "unavailable";
    });
    try {
      const xPosts = await this.x();
      posts.push(...xPosts);
      sources.x = !this.config.xBearer
        ? "credential_required"
        : !this.config.xDailyBudget
          ? "budget_disabled"
          : "live";
    } catch {
      sources.x = "unavailable";
    }
    if (this.config.discordBotToken && this.config.discordChannelIds) {
      const ids = this.config.discordChannelIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^\d{15,22}$/.test(id))
        .slice(0, 5);
      const discord = await Promise.allSettled(ids.map((id) => this.discord(id)));
      posts.push(
        ...discord.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
      );
      sources.discord = discord.some((result) => result.status === "fulfilled")
        ? "live"
        : "unavailable";
    } else sources.discord = "bot_access_required";
    const unique = new Map(posts.map((post) => [post.id, post]));
    const value = {
      posts: [...unique.values()]
        .filter((post) => Number.isFinite(Date.parse(post.publishedAt)))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .slice(0, 80),
      sources,
      until: Date.now() + 15 * 60_000,
    };
    this.cache = value;
    return value;
  }

  private async reddit(community: string): Promise<SocialPost[]> {
    const response = await fetch(`https://www.reddit.com/r/${community}/new/.rss?limit=10`, {
      headers: { "user-agent": "Sisera/2.0 social research" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`Reddit ${response.status}`);
    const parsed = RedditFeed.parse(
      new XMLParser({ ignoreAttributes: false }).parse(await response.text()),
    );
    const entries = Array.isArray(parsed.feed.entry)
      ? parsed.feed.entry
      : parsed.feed.entry
        ? [parsed.feed.entry]
        : [];
    return entries.flatMap((entry): SocialPost[] => {
      const item = RedditEntry.safeParse(entry);
      return item.success
        ? [
            {
              id: item.data.id,
              platform: "reddit",
              community: `r/${community}`,
              text: item.data.title,
              url: item.data.link["@_href"],
              publishedAt: new Date(item.data.updated).toISOString(),
            },
          ]
        : [];
    });
  }

  private async telegram(channel: string): Promise<SocialPost[]> {
    const response = await fetch(`https://t.me/s/${channel}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`Telegram ${response.status}`);
    const html = await response.text();
    const blocks =
      html.match(
        /<div class="tgme_widget_message_wrap[\s\S]*?(?=<div class="tgme_widget_message_wrap|<div class="tgme_channel_info_header|$)/g,
      ) ?? [];
    return blocks.slice(-12).flatMap((block): SocialPost[] => {
      const url = block.match(/data-post="([A-Za-z0-9_]+\/\d+)"/)?.[1];
      const date = block.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
      const text = block.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/)?.[1];
      if (!url || !date || !text) return [];
      return [
        {
          id: `telegram:${url}`,
          platform: "telegram",
          community: `@${channel}`,
          text: decodeHtml(text).slice(0, 700),
          url: `https://t.me/${url}`,
          publishedAt: new Date(date).toISOString(),
        },
      ];
    });
  }

  private async x(): Promise<SocialPost[]> {
    if (!this.config.xBearer || !this.config.xDailyBudget || this.config.xDailyBudget <= 0)
      return [];
    if (Date.now() - this.xLastFetch < 24 * 60 * 60_000) return this.xPosts;
    const accounts =
      this.config.xAccounts
        ?.split(",")
        .map((name) => name.trim().replace(/^@/, ""))
        .filter((name) => /^[A-Za-z0-9_]{1,15}$/.test(name))
        .slice(0, 8) ?? defaultX;
    const url = new URL("https://api.x.com/2/tweets/search/recent");
    url.searchParams.set(
      "query",
      `(${accounts.map((name) => `from:${name}`).join(" OR ")}) -is:retweet`,
    );
    url.searchParams.set("max_results", "10");
    url.searchParams.set("tweet.fields", "created_at,author_id");
    url.searchParams.set("expansions", "author_id");
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.config.xBearer}` },
      signal: AbortSignal.timeout(7000),
    });
    this.xLastFetch = Date.now();
    if (!response.ok) throw new Error(`X ${response.status}`);
    const data = XSearch.parse(await response.json());
    const usernames = new Map(data.includes?.users?.map((user) => [user.id, user.username]) ?? []);
    this.xPosts = data.data.map((item) => ({
      id: `x:${item.id}`,
      platform: "x" as const,
      community: `@${usernames.get(item.author_id) ?? "X"}`,
      text: item.text,
      url: `https://x.com/i/web/status/${item.id}`,
      publishedAt: item.created_at,
    }));
    return this.xPosts;
  }

  private async discord(channelId: string): Promise<SocialPost[]> {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=10`,
      {
        headers: { authorization: `Bot ${this.config.discordBotToken}` },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!response.ok) throw new Error(`Discord ${response.status}`);
    const messages = z
      .array(
        z.object({
          id: z.string(),
          content: z.string(),
          timestamp: z.string(),
          guild_id: z.string().optional(),
        }),
      )
      .parse(await response.json());
    return messages
      .filter((item) => item.content.trim())
      .map((item) => ({
        id: `discord:${item.id}`,
        platform: "discord",
        community: `Channel ${channelId}`,
        text: item.content.slice(0, 700),
        url: `https://discord.com/channels/${item.guild_id ?? "@me"}/${channelId}/${item.id}`,
        publishedAt: item.timestamp,
      }));
  }
}
