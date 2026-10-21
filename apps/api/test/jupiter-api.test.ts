import { describe, expect, it, vi } from "vitest";
import { jupiterFetch } from "../src/jupiter-api.js";
import { JupiterQuoteClient, swapFailure } from "../src/jupiter.js";

const quote = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inAmount: "100000000",
  outAmount: "10679412",
  router: "metis",
  requestId: "req-1",
  transaction: null,
};

describe("Jupiter API access", () => {
  it("falls back to the keyless API when the key is rejected, and stops sending it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
      url.startsWith("https://api.jup.ag")
        ? new Response('{"code":401,"message":"Unauthorized"}', { status: 401 })
        : Response.json({ ok: true }),
    );
    const jupiter = jupiterFetch("revoked-key", fetcher as unknown as typeof fetch);

    expect((await jupiter("/price/v3?ids=x")).status).toBe(200);
    await jupiter("/price/v3?ids=y");
    const urls = fetcher.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      "https://api.jup.ag/price/v3?ids=x",
      "https://lite-api.jup.ag/price/v3?ids=x",
      // The rejected key is paused rather than retried on every request.
      "https://lite-api.jup.ag/price/v3?ids=y",
    ]);
    const keyless = fetcher.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(JSON.stringify(keyless?.headers ?? {})).not.toContain("revoked-key");
  });

  it("keeps using a working key", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const jupiter = jupiterFetch("good-key", fetcher as unknown as typeof fetch);
    await jupiter("/tokens/v2/search?query=x");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]).toEqual([
      "https://api.jup.ag/tokens/v2/search?query=x",
      { headers: { "x-api-key": "good-key" } },
    ]);
  });

  it("still quotes swaps when the configured key is revoked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("https://api.jup.ag")
          ? new Response("Unauthorized", { status: 401 })
          : Response.json(quote),
      ),
    );
    const result = await new JupiterQuoteClient("revoked-key").preview(
      quote.inputMint,
      quote.outputMint,
      quote.inAmount,
    );
    expect(result.outAmount).toBe("10679412");
    vi.unstubAllGlobals();
  });

  it("only blames liquidity when Jupiter actually refuses the quote", async () => {
    const failing = (status: number) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response('{"error":"x"}', { status })),
      );
      return new JupiterQuoteClient()
        .preview(quote.inputMint, quote.outputMint, "1")
        .catch((error: unknown) => swapFailure(error));
    };
    expect(await failing(400)).toMatchObject({ noRoute: true });
    expect(await failing(429)).toMatchObject({
      noRoute: false,
      message: "Swaps are busy right now. Try again in a few seconds.",
    });
    expect(await failing(503)).toMatchObject({
      noRoute: false,
      message: "Swaps are temporarily unavailable. Try again shortly.",
    });
    vi.unstubAllGlobals();
  });
});
