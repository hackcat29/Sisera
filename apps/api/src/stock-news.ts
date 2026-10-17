import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

const GNewsResponse = z.object({
  articles: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().nullable().optional(),
        url: z.string().url(),
        publishedAt: z.string(),
        source: z.object({ name: z.string() }),
      }),
    )
    .default([]),
});

const FinnhubNews = z.array(
  z.object({
    headline: z.string(),
    summary: z.string().optional(),
    url: z.string().url(),
    datetime: z.number(),
    source: z.string(),
  }),
);

const GdeltNews = z.object({
  articles: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string(),
        seendate: z.string(),
        domain: z.string().optional(),
      }),
    )
    .default([]),
});
const MarketauxNews = z.object({
  data: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().nullable().optional(),
        url: z.string().url(),
        published_at: z.string(),
        source: z.string(),
      }),
    )
    .default([]),
});
const RssFeed = z.object({
  rss: z.object({
    channel: z.object({
      item: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    }),
  }),
});
const RssItem = z.object({
  title: z.string(),
  link: z.string().url(),
  pubDate: z.string(),
  source: z.string().optional(),
});

export type NewsItem = {
  title: string;
  summary: string | null;
  url: string;
  publishedAt: string;
  publisher: string;
  provider: "gnews" | "finnhub" | "gdelt" | "marketaux" | "google-news" | "bing-news";
};

const JUNK_NEWS =
  /\b(currency converter|exchange rate|usd to|price prediction|live price chart|token price today)\b/i;

export function relevantCompanyNews(
  article: NewsItem,
  company: string,
  publicSymbol?: string,
  now = Date.now(),
) {
  const published = Date.parse(article.publishedAt);
  if (!Number.isFinite(published) || published > now + 60_000 || now - published > 14 * 86_400_000)
    return false;
  if (JUNK_NEWS.test(`${article.title} ${article.url}`)) return false;
  const terms = company
    .replace(/\b(?:incorporated|corporation|company|limited|inc|corp|ltd|xstock)\b/gi, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(
      (term) => term.length >= 4 && !["the", "group", "holdings"].includes(term.toLowerCase()),
    );
  if (publicSymbol && publicSymbol.length >= 3) terms.push(publicSymbol);
  if (!terms.length) return false;
  const text = `${article.title} ${article.summary ?? ""}`;
  return terms.some((term) =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
  );
}

export class StockNewsClient {
  private readonly cache = new Map<
    string,
    { until: number; value: { data: NewsItem[]; providers: string[]; available: boolean } }
  >();
  constructor(
    private readonly gnewsKey?: string,
    private readonly finnhubKey?: string,
    private readonly marketauxKey?: string,
  ) {}

  async search(
    company: string,
    publicSymbol?: string,
  ): Promise<{ data: NewsItem[]; providers: string[]; available: boolean }> {
    const key = `${company}:${publicSymbol ?? ""}`;
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const searches: Array<Promise<NewsItem[]>> = [];
    const providers: string[] = ["gdelt", "google-news", "bing-news"];
    const rssQuery = company.replace(/["\\]/g, "").slice(0, 80);
    const rssSources = [
      {
        provider: "google-news" as const,
        url: `https://news.google.com/rss/search?${new URLSearchParams({ q: rssQuery, hl: "en-US", gl: "US", ceid: "US:en" })}`,
      },
      {
        provider: "bing-news" as const,
        url: `https://www.bing.com/news/search?${new URLSearchParams({ q: rssQuery, format: "rss" })}`,
      },
    ];
    for (const source of rssSources) {
      searches.push(
        fetch(source.url, {
          headers: { accept: "application/rss+xml, application/xml" },
          signal: AbortSignal.timeout(5000),
        }).then(async (response) => {
          if (!response.ok) throw new Error(`${source.provider} returned ${response.status}`);
          const parsed = RssFeed.parse(
            new XMLParser({ ignoreAttributes: true }).parse(await response.text()),
          );
          const raw = parsed.rss.channel.item;
          const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
          return items.flatMap((item): NewsItem[] => {
            const article = RssItem.safeParse(item);
            if (!article.success) return [];
            const date = new Date(article.data.pubDate);
            if (Number.isNaN(date.getTime())) return [];
            return [
              {
                title: article.data.title,
                summary: null,
                url: article.data.link,
                publishedAt: date.toISOString(),
                publisher: article.data.source ?? source.provider,
                provider: source.provider,
              },
            ];
          });
        }),
      );
    }
    const gdelt = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    gdelt.search = new URLSearchParams({
      query: `"${company.replace(/["\\]/g, "").slice(0, 80)}"`,
      mode: "artlist",
      format: "json",
      maxrecords: "20",
      timespan: "7d",
      sort: "datedesc",
    }).toString();
    searches.push(
      fetch(gdelt, { signal: AbortSignal.timeout(3500) }).then(async (response) => {
        if (!response.ok) throw new Error(`GDELT returned ${response.status}`);
        return GdeltNews.parse(await response.json()).articles.flatMap((article) => {
          const publishedAt = /^\d{14}$/.test(article.seendate)
            ? `${article.seendate.slice(0, 4)}-${article.seendate.slice(4, 6)}-${article.seendate.slice(6, 8)}T${article.seendate.slice(8, 10)}:${article.seendate.slice(10, 12)}:${article.seendate.slice(12, 14)}Z`
            : null;
          return publishedAt && !Number.isNaN(Date.parse(publishedAt))
            ? [
                {
                  title: article.title,
                  summary: null,
                  url: article.url,
                  publishedAt,
                  publisher: article.domain ?? new URL(article.url).hostname,
                  provider: "gdelt" as const,
                },
              ]
            : [];
        });
      }),
    );
    if (this.marketauxKey) {
      providers.push("marketaux");
      const url = new URL("https://api.marketaux.com/v1/news/all");
      url.search = new URLSearchParams({
        ...(publicSymbol ? { symbols: publicSymbol } : { search: company }),
        language: "en",
        limit: "3",
        api_token: this.marketauxKey,
      }).toString();
      searches.push(
        fetch(url, { signal: AbortSignal.timeout(5000) }).then(async (response) => {
          if (!response.ok) throw new Error(`Marketaux returned ${response.status}`);
          return MarketauxNews.parse(await response.json()).data.map((article) => ({
            title: article.title,
            summary: article.description ?? null,
            url: article.url,
            publishedAt: article.published_at,
            publisher: article.source,
            provider: "marketaux" as const,
          }));
        }),
      );
    }
    if (this.gnewsKey) {
      providers.push("gnews");
      const url = new URL("https://gnews.io/api/v4/search");
      url.search = new URLSearchParams({
        q: `"${company}"`,
        lang: "en",
        max: "10",
        sortby: "publishedAt",
        apikey: this.gnewsKey,
      }).toString();
      searches.push(
        fetch(url, { signal: AbortSignal.timeout(7000) }).then(async (response) => {
          if (!response.ok) throw new Error(`GNews returned ${response.status}`);
          return GNewsResponse.parse(await response.json()).articles.map((article) => ({
            title: article.title,
            summary: article.description ?? null,
            url: article.url,
            publishedAt: article.publishedAt,
            publisher: article.source.name,
            provider: "gnews" as const,
          }));
        }),
      );
    }
    if (this.finnhubKey && publicSymbol) {
      providers.push("finnhub");
      const url = new URL("https://finnhub.io/api/v1/company-news");
      const now = new Date();
      const from = new Date(now.getTime() - 7 * 86_400_000);
      url.search = new URLSearchParams({
        symbol: publicSymbol,
        from: from.toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
      }).toString();
      searches.push(
        fetch(url, {
          headers: { "X-Finnhub-Token": this.finnhubKey },
          signal: AbortSignal.timeout(7000),
        }).then(async (response) => {
          if (!response.ok) throw new Error(`Finnhub returned ${response.status}`);
          return FinnhubNews.parse(await response.json()).map((article) => ({
            title: article.headline,
            summary: article.summary ?? null,
            url: article.url,
            publishedAt: new Date(article.datetime * 1000).toISOString(),
            publisher: article.source,
            provider: "finnhub" as const,
          }));
        }),
      );
    }
    const results = await Promise.allSettled(searches);
    const seen = new Set<string>();
    const data = results
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .filter((article) => relevantCompanyNews(article, company, publicSymbol))
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .filter((article) => {
        if (seen.has(article.url)) return false;
        seen.add(article.url);
        return true;
      })
      .slice(0, 20);
    const value = {
      data,
      providers,
      available: results.some((result) => result.status === "fulfilled"),
    };
    this.cache.set(key, { until: Date.now() + 5 * 60_000, value });
    return value;
  }
}
