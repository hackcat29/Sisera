import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE_MODEL_FALLBACKS, OpenRouterChat, OpenRouterResearchClient } from "../src/index.js";

afterEach(() => vi.unstubAllGlobals());

describe("read-only OpenRouter research", () => {
  const context = {
    company: "Example",
    symbol: "EX",
    tokenPrice: "10",
    referencePrice: "9",
    referenceKind: "prestocks_mark" as const,
    referenceFreshness: "unavailable" as const,
    referenceObservedAt: null,
    premiumDiscountPct: "11.1",
    volume24hUsd: null,
    liquidityUsd: null,
    change24hPct: null,
    tradingHalted: false,
    fetchedAt: "2026-09-25T00:00:00Z",
    articles: [],
  };

  it("validates structured research output and never returns execution commands", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Mark gap requires liquidity checks.",
                opportunities: ["Investigate valuation"],
                risks: ["Liquidity unknown"],
                confidence: 0.4,
                actionability: "research_only",
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await new OpenRouterResearchClient("secret", "model").assess(context);
    expect(result.actionability).toBe("research_only");
    expect(result).not.toHaveProperty("order");
    const request = JSON.parse(fetcher.mock.calls[0]?.[1].body);
    expect(request.response_format.type).toBe("json_schema");
    expect(request.messages[1].content).toContain("Example");
  });

  it("rejects executable-looking model output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Buy now",
                  opportunities: [],
                  risks: [],
                  confidence: 1,
                  actionability: "execute",
                }),
              },
            },
          ],
        }),
      }),
    );
    await expect(new OpenRouterResearchClient("secret", "model").assess(context)).rejects.toThrow();
  });
});

const reply = (content: string | null) => Response.json({ choices: [{ message: { content } }] });

describe("OpenRouter model fallbacks", () => {
  it("moves past a withdrawn model, and skips it on later requests", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model;
      return model === "dead/model:free" ? new Response("{}", { status: 404 }) : reply("Brief.");
    });
    const chat = new OpenRouterChat("key", "dead/model:free", fetcher as unknown as typeof fetch);
    expect(await chat.completeWithModel([{ role: "user", content: "hi" }])).toEqual({
      text: "Brief.",
      model: FREE_MODEL_FALLBACKS[0]?.id,
    });
    await chat.complete([{ role: "user", content: "again" }]);
    const models = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).model);
    expect(models).toEqual([
      "dead/model:free",
      FREE_MODEL_FALLBACKS[0]?.id,
      FREE_MODEL_FALLBACKS[0]?.id,
    ]);
  });

  it("turns reasoning off and treats an empty reply as a failure", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? reply("") : reply("Answer.");
    });
    const chat = new OpenRouterChat("key", undefined, fetcher as unknown as typeof fetch);
    expect(await chat.complete([{ role: "user", content: "hi" }], { maxTokens: 160 })).toBe(
      "Answer.",
    );
    expect(bodies[0]?.reasoning).toEqual({ enabled: false });
    expect(bodies.map((body) => body.model)).toEqual(
      FREE_MODEL_FALLBACKS.slice(0, 2).map((entry) => entry.id),
    );
  });

  it("asks JSON-mode models for the schema and moves on from output that fails validation", async () => {
    type Body = {
      model: string;
      response_format?: { type: string };
      messages: Array<{ content: string }>;
    };
    const bodies: Body[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Body;
      bodies.push(body);
      if (body.model === "minimax/minimax-m3.1-flash:free")
        return reply('```json\n{"answer":"ok"}\n```');
      return reply('{"wrong":true}');
    });
    const chat = new OpenRouterChat("key", undefined, fetcher as unknown as typeof fetch);
    const text = await chat.complete([{ role: "user", content: "hi" }], {
      jsonSchema: { name: "answer", schema: { type: "object" } },
      validate: (output) => {
        if (!("answer" in JSON.parse(output))) throw new Error("missing answer");
      },
    });
    expect(text).toBe('{"answer":"ok"}');
    expect(bodies[0]?.response_format?.type).toBe("json_schema");
    expect(bodies.at(-1)?.response_format).toEqual({ type: "json_object" });
    expect(bodies.at(-1)?.messages.at(-1)?.content).toContain("JSON Schema");
  });

  it("fails once every model has failed, within the time budget", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 503 }));
    const chat = new OpenRouterChat("key", "a/b:free", fetcher as unknown as typeof fetch);
    await expect(chat.complete([{ role: "user", content: "hi" }])).rejects.toThrow(/503/);
    expect(fetcher).toHaveBeenCalledTimes(1 + FREE_MODEL_FALLBACKS.length);
  });
});
