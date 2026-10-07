import { listMarketEvents, upsertMarketEvents } from "@sisera/db";
import {
  type MarketEvent,
  type RawItem,
  type UniverseAsset,
  classifyItem,
  clusterEvents,
  dedupeByUrl,
  explainMove,
  filterEvents,
  isUsableItem,
  summarizeChanges,
} from "@sisera/intelligence";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { SocialFeedClient } from "../social-feed.js";
import type { StockNewsClient } from "../stock-news.js";
import { AssetCatalog, type CatalogAsset } from "./catalog.js";
import type { SecEdgarClient } from "./sec-edgar.js";

const MACRO_QUERIES = [
  "Federal Reserve interest rates",
  "CPI inflation report",
  "jobs report nonfarm payrolls",
  "tariffs stock market",
  "stock market today selloff OR rally",
  "SEC crypto tokenized stocks",
];

const RssFeed = z.object({
  rss: z.object({
    channel: z.object({ item: z.union([z.array(z.unknown()), z.unknown()]).optional() }),
  }),
});
const RssItem = z.object({
  title: z.string(),
  link: z.string().url(),
  pubDate: z.string(),
  source: z.unknown().optional(),
});

export type AssetIntelligence = {
  asset: { key: string; symbol: string; name: string; kind: string };
  events: MarketEvent[];
  providers: Record<string, "live" | "unavailable" | "not_applicable">;
  fetchedAt: string;
};

/**
 * Collects news, regulatory filings, macro headlines and social posts, classifies every item and
 * clusters them into events. Events are persisted when a database is configured and kept in a
 * bounded in-memory store otherwise, so "what changed" works across requests.
 */
export class IntelligenceService {
  private readonly memory = new Map<string, MarketEvent>();
  private readonly assetCache = new Map<string, { until: number; value: AssetIntelligence }>();
  private macroCache: { until: number; value: MarketEvent[] } | null = null;
  private universeCache: { until: number; value: UniverseAsset[] } | null = null;

  constructor(
    private readonly catalog: AssetCatalog,
    private readonly news: StockNewsClient,
    private readonly edgar: SecEdgarClient,
    private readonly social: SocialFeedClient,
    private readonly databaseUrl: string | undefined,
  ) {}

  private async universe(): Promise<UniverseAsset[]> {
    if (this.universeCache && this.universeCache.until > Date.now())
      return this.universeCache.value;
    const assets = await this.catalog.list();
    const value = assets.map(AssetCatalog.toUniverse);
    this.universeCache = { until: Date.now() + 10 * 60_000, value };
    return value;
  }

  private remember(events: readonly MarketEvent[]) {
    for (const event of events) this.memory.set(event.id, event);
    if (this.memory.size > 5000) {
      const oldest = [...this.memory.values()]
        .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))
        .slice(0, 1000);
      for (const event of oldest) this.memory.delete(event.id);
    }
    if (this.databaseUrl) void upsertMarketEvents(this.databaseUrl, events).catch(() => undefined);
  }

  async forAsset(
    asset: CatalogAsset,
    options: { force?: boolean } = {},
  ): Promise<AssetIntelligence> {
    const cached = this.assetCache.get(asset.key);
    if (!options.force && cached && cached.until > Date.now()) return cached.value;
    const universe = await this.universe();
    const pinned = AssetCatalog.toUniverse(asset);
    const providers: AssetIntelligence["providers"] = {};
    const ticker = asset.kind === "public_equity" ? asset.underlying : undefined;
    const searchName =
      asset.kind === "agent_token"
        ? `${asset.symbol} ${asset.name} clawpump`
        : asset.name.replace(/\bxstock\b/i, "").trim();
    const [news, filings, social] = await Promise.allSettled([
      this.news.search(searchName, ticker),
      ticker ? this.edgar.filings(ticker) : Promise.resolve([] as RawItem[]),
      this.social.list(),
    ]);
    providers.news = news.status === "fulfilled" ? "live" : "unavailable";
    providers.filings = ticker
      ? filings.status === "fulfilled"
        ? "live"
        : "unavailable"
      : "not_applicable";
    providers.social = social.status === "fulfilled" ? "live" : "unavailable";
    const raw: RawItem[] = [
      ...(news.status === "fulfilled" ? news.value.data : []),
      ...(filings.status === "fulfilled" ? filings.value : []),
      ...(social.status === "fulfilled"
        ? social.value.posts.map(
            (post): RawItem => ({
              title: post.text.slice(0, 280),
              summary: null,
              url: post.url,
              publishedAt: post.publishedAt,
              publisher: `${post.platform}:${post.community}`,
              provider: post.platform,
              kind: "social",
            }),
          )
        : []),
    ];
    const classified = dedupeByUrl(raw)
      .filter((item) => isUsableItem(item))
      .map((item) => classifyItem(item, universe, item.kind === "social" ? undefined : pinned))
      // Social posts are kept only when they actually mention the asset.
      .filter(
        (item) =>
          item.kind !== "social" ||
          item.assets.some((match) => match.key === asset.key && match.via !== "query"),
      );
    const events = clusterEvents(classified).filter((event) =>
      event.assets.some((match) => match.key === asset.key),
    );
    this.remember(events);
    const value: AssetIntelligence = {
      asset: { key: asset.key, symbol: asset.symbol, name: asset.name, kind: asset.kind },
      events,
      providers,
      fetchedAt: new Date().toISOString(),
    };
    this.assetCache.set(asset.key, { until: Date.now() + 5 * 60_000, value });
    if (this.assetCache.size > 400)
      this.assetCache.delete(this.assetCache.keys().next().value ?? "");
    return value;
  }

  async macro(): Promise<MarketEvent[]> {
    if (this.macroCache && this.macroCache.until > Date.now()) return this.macroCache.value;
    const universe = await this.universe().catch(() => [] as UniverseAsset[]);
    const parser = new XMLParser({ ignoreAttributes: true });
    const results = await Promise.allSettled(
      MACRO_QUERIES.map(async (query) => {
        const response = await fetch(
          `https://news.google.com/rss/search?${new URLSearchParams({ q: `${query} when:2d`, hl: "en-US", gl: "US", ceid: "US:en" })}`,
          { headers: { accept: "application/rss+xml" }, signal: AbortSignal.timeout(6000) },
        );
        if (!response.ok) throw new Error(`Google News returned ${response.status}`);
        const parsed = RssFeed.parse(parser.parse(await response.text()));
        const rawItems = parsed.rss.channel.item;
        const list = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
        return list.slice(0, 15).flatMap((entry): RawItem[] => {
          const item = RssItem.safeParse(entry);
          if (!item.success) return [];
          const date = new Date(item.data.pubDate);
          if (Number.isNaN(date.getTime())) return [];
          const publisher =
            typeof item.data.source === "string"
              ? item.data.source
              : (item.data.title.split(" - ").at(-1) ?? "Google News");
          return [
            {
              title: item.data.title,
              summary: null,
              url: item.data.link,
              publishedAt: date.toISOString(),
              publisher,
              provider: "google-news",
              kind: "macro",
            },
          ];
        });
      }),
    );
    const items = dedupeByUrl(
      results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
    )
      .filter((item) => isUsableItem(item, Date.now(), 3))
      .map((item) => classifyItem(item, universe));
    const events = clusterEvents(items);
    this.remember(events);
    this.macroCache = { until: Date.now() + 10 * 60_000, value: events };
    return events;
  }

  /** Topic retrieval preserves entity matching; a search query never establishes company exposure. */
  async forTopic(text: string): Promise<MarketEvent[]> {
    const [result, universe] = await Promise.all([
      this.news.search(text.slice(0, 300)),
      this.universe(),
    ]);
    const events = clusterEvents(
      dedupeByUrl(result.data)
        .filter((item) => isUsableItem(item, Date.now(), 14))
        .map((item) => classifyItem(item, universe)),
    );
    this.remember(events);
    return events;
  }

  /** Stored events, newest first, optionally narrowed to one asset or a time window. */
  async stored(
    filter: { since?: string; assetKey?: string; limit?: number } = {},
  ): Promise<MarketEvent[]> {
    if (this.databaseUrl) {
      try {
        return await listMarketEvents<MarketEvent>(this.databaseUrl, filter);
      } catch {
        // Fall back to memory when the database is briefly unavailable.
      }
    }
    return filterEvents([...this.memory.values()], {
      ...(filter.since ? { since: filter.since } : {}),
      ...(filter.assetKey ? { assetKey: filter.assetKey } : {}),
    })
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, filter.limit ?? 200);
  }

  async whatChanged(sinceMinutes: number, assetKeys?: readonly string[]) {
    const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
    const [stored, macro, assets] = await Promise.all([
      this.stored({ since, limit: 300 }),
      this.macro().catch(() => [] as MarketEvent[]),
      this.catalog.list(),
    ]);
    const byId = new Map([...stored, ...macro].map((event) => [event.id, event]));
    let events = [...byId.values()].filter((event) => event.lastSeenAt >= since);
    if (assetKeys?.length) {
      const keys = new Set(assetKeys);
      events = events.filter(
        (event) =>
          event.assets.some((asset) => keys.has(asset.key)) ||
          event.categories.includes("macro") ||
          event.categories.includes("rates"),
      );
    }
    events.sort((a, b) => b.impactScore - a.impactScore);
    const moves = assets
      .filter((asset) => !assetKeys?.length || assetKeys.includes(asset.key))
      .filter((asset) => (asset.liquidityUsd ?? 0) > 5_000)
      .map((asset) => ({
        key: asset.key,
        symbol: asset.symbol,
        changePct: sinceMinutes <= 90 ? (asset.change1hPct ?? null) : asset.change24hPct,
        windowLabel: sinceMinutes <= 90 ? "1h" : "24h",
      }));
    return summarizeChanges(events, since, moves);
  }

  async explain(asset: CatalogAsset, windowHours = 24) {
    const intelligence = await this.forAsset(asset);
    const macro = await this.macro().catch(() => [] as MarketEvent[]);
    const change = windowHours <= 1 ? asset.change1hPct : asset.change24hPct;
    return {
      ...explainMove(AssetCatalog.toUniverse(asset), change, intelligence.events, windowHours),
      macroBackdrop: macro.slice(0, 3).map((event) => ({
        headline: event.headline,
        severity: event.severity,
        certainty: event.certainty,
        sentiment: event.sentiment,
      })),
      providers: intelligence.providers,
    };
  }

  /** Refreshes events for a watchlist in the background with bounded concurrency. */
  async refreshWatchlist(assets: readonly CatalogAsset[], concurrency = 3): Promise<number> {
    let next = 0;
    let refreshed = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, assets.length) }, async () => {
        while (next < assets.length) {
          const asset = assets[next++];
          if (!asset) continue;
          await this.forAsset(asset, { force: true }).then(
            () => refreshed++,
            () => undefined,
          );
        }
      }),
    );
    await this.macro().catch(() => undefined);
    return refreshed;
  }
}
