import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClawpumpClient } from "../src/clawpump.js";
import { JupiterQuoteClient } from "../src/jupiter.js";
import { verifySignedSwap } from "../src/solana-trading.js";
import { StockNewsClient, relevantCompanyNews } from "../src/stock-news.js";
import { XStocksClient } from "../src/xstocks.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("stock provider boundaries", () => {
  it("keeps Jupiter previews quote-only and strips transaction payloads", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inAmount: "1000000",
        outAmount: "995000",
        router: "metis",
        requestId: "req-1",
        transaction: null,
      }),
    });
    vi.stubGlobal("fetch", fetcher);
    const quote = await new JupiterQuoteClient("test-key").preview(
      "So11111111111111111111111111111111111111112",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "1000000",
    );
    const url = new URL(fetcher.mock.calls[0]?.[0]);
    expect(url.searchParams.has("taker")).toBe(false);
    expect(quote.executable).toBe(false);
    expect(quote).not.toHaveProperty("transaction");
  });

  it("rejects an unexpected transaction in a quote-only response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          inputMint: "a",
          outputMint: "b",
          inAmount: "1",
          outAmount: "1",
          router: "metis",
          requestId: "r",
          transaction: "signed?",
        }),
      }),
    );
    await expect(new JupiterQuoteClient("key").preview("a", "b", "1")).rejects.toThrow();
  });

  it("sends Clawpump credentials only to the apex endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tokens: [] }) });
    vi.stubGlobal("fetch", fetcher);
    const key = `cpk_${"a".repeat(43)}`;
    await new ClawpumpClient(key).search("AAPL");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "https://clawpump.tech/api/v1/tokens/search",
    );
    expect(fetcher.mock.calls[0]?.[1].redirect).toBe("error");
    expect(fetcher.mock.calls[0]?.[1].headers.Authorization).toBe(`Bearer ${key}`);
  });

  it("searches GDELT without an API key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          articles: [
            {
              title: "SpaceX launch",
              url: "https://example.com/story",
              seendate: "20260925120000",
              domain: "example.com",
            },
          ],
        }),
      }),
    );
    const result = await new StockNewsClient().search("SpaceX");
    expect(result.providers).toContain("gdelt");
    expect(result.data[0]?.publishedAt).toBe("2026-09-25T12:00:00Z");
  });

  it("renders free RSS news when GDELT is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string | URL) => {
        if (String(url).includes("news.google.com"))
          return new Response(
            `<?xml version="1.0"?><rss><channel><item><title>SpaceX update</title><link>https://example.com/rss</link><pubDate>Fri, 25 Sep 2026 12:00:00 GMT</pubDate><source>Example</source></item></channel></rss>`,
          );
        return new Response("unavailable", { status: 503 });
      }),
    );
    const result = await new StockNewsClient().search("SpaceX");
    expect(result.data[0]?.title).toBe("SpaceX update");
    expect(result.data[0]?.provider).toBe("google-news");
  });

  it("rejects stale converter pages and unrelated issuer news", () => {
    const now = Date.parse("2026-09-27T00:00:00Z");
    const article = {
      title: "Apple announces new device",
      summary: null,
      url: "https://example.com/apple",
      publishedAt: "2026-09-26T12:00:00Z",
      publisher: "Example",
      provider: "gdelt" as const,
    };
    expect(relevantCompanyNews(article, "Apple Inc.", "AAPL", now)).toBe(true);
    expect(
      relevantCompanyNews(
        { ...article, title: "USD to EUR currency converter" },
        "Apple Inc.",
        "AAPL",
        now,
      ),
    ).toBe(false);
    expect(
      relevantCompanyNews(
        { ...article, title: "Microsoft announces new device" },
        "Apple Inc.",
        "AAPL",
        now,
      ),
    ).toBe(false);
    expect(
      relevantCompanyNews(
        { ...article, publishedAt: "2026-08-01T12:00:00Z" },
        "Apple Inc.",
        "AAPL",
        now,
      ),
    ).toBe(false);
  });

  it("keeps public stock mints tied to the issuer catalogue", async () => {
    const mint = "XsensupeZBdHxZtdnLptf1UfWpVyancWcit7qWFYZrJ";
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/public/assets?"))
        return {
          ok: true,
          json: async () => ({
            nodes: [
              {
                name: "Xerox xStock",
                symbol: "XRXx",
                isTradingHalted: false,
                underlying: { symbol: "XRX", type: "Equity" },
                deployments: [{ address: mint, network: "Solana" }],
              },
            ],
            page: { hasNextPage: false },
          }),
        };
      if (url.includes("dexscreener"))
        return {
          ok: true,
          json: async () => [
            {
              chainId: "solana",
              baseToken: { address: mint },
              priceUsd: "3.4",
              liquidity: { usd: 2000 },
            },
          ],
        };
      return { ok: false };
    });
    const data = await new XStocksClient(fetcher).list();
    expect(data).toHaveLength(1);
    expect(data[0]?.mint).toBe(mint);
    expect(data[0]?.dexPriceUsd).toBe("3.4");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("price-data"))).toBe(false);
  });

  it("accepts only the wallet signature on the original transaction message", () => {
    const signer = Keypair.generate();
    const message = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message();
    const unsigned = new VersionedTransaction(message);
    const signed = new VersionedTransaction(message);
    signed.sign([signer]);
    expect(() =>
      verifySignedSwap(
        Buffer.from(unsigned.serialize()).toString("base64"),
        Buffer.from(signed.serialize()).toString("base64"),
        signer.publicKey.toBase58(),
      ),
    ).not.toThrow();
    expect(() =>
      verifySignedSwap(
        Buffer.from(unsigned.serialize()).toString("base64"),
        Buffer.from(signed.serialize()).toString("base64"),
        Keypair.generate().publicKey.toBase58(),
      ),
    ).toThrow();
  });
});
