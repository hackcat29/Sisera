import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeUnavailable, EvmSwapQuoteInput, RelayBridgeClient } from "../src/bridge.js";
import { EVM_SWAP_CHAINS, EvmAssetClient, NATIVE_TOKEN, decodeSymbol } from "../src/evm-assets.js";
import { EvmSwapService } from "../src/evm-swap.js";

const user = "0x03508bb71268bba25ecacc8f620e01866650532c";
const solana = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const solanaUsdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const usdt = "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9";
const hex = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
afterEach(() => vi.unstubAllGlobals());

/** A JSON-RPC endpoint that answers every batch with `answer(call)`. */
function rpc(answer: (call: { method: string; params: unknown[] }) => string | null) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const batch = JSON.parse(String(init?.body)) as Array<{
      id: number;
      method: string;
      params: unknown[];
    }>;
    return Response.json(
      batch.map((call) => {
        const result = answer(call);
        return result == null
          ? { jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "reverted" } }
          : { jsonrpc: "2.0", id: call.id, result };
      }),
    );
  });
}

function relayQuote(
  overrides: Record<string, unknown> = {},
  details: Record<string, unknown> = {},
) {
  return {
    steps: [
      {
        id: "approve",
        kind: "transaction",
        requestId: `0x${"b".repeat(64)}`,
        items: [{ data: { from: user, to: usdt, data: "0x095ea7b3", value: "0", chainId: 42161 } }],
      },
      { id: "authorize", kind: "signature", items: [] },
      {
        id: "deposit",
        kind: "transaction",
        requestId: `0x${"b".repeat(64)}`,
        items: [{ data: { from: user, to: user, data: "0x1234", value: "0", chainId: 42161 } }],
      },
    ],
    fees: {
      gas: { amount: "1800000000000", currency: { chainId: 42161, address: NATIVE_TOKEN } },
    },
    details: {
      currencyIn: {
        amount: "50000000",
        amountUsd: "49.94",
        currency: { chainId: 42161, address: usdt, symbol: "USDT0", decimals: 6 },
      },
      currencyOut: {
        amount: "49899898",
        minimumAmount: "48901900",
        currency: { address: solanaUsdc, decimals: 6 },
      },
      swapImpact: { percent: "-0.01" },
      totalImpact: { percent: "-0.09" },
      timeEstimate: 9,
      ...details,
    },
    ...overrides,
  };
}

const swap = {
  originChainId: 42161,
  destinationChainId: 792703809,
  originCurrency: usdt,
  amount: "50000000",
  user,
  recipient: solana,
};

describe("EVM wallet assets", () => {
  it("reads curated balances in batches of ten and keeps a gas reserve on native tokens", async () => {
    const fetcher = rpc((call) =>
      call.method === "eth_getBalance"
        ? hex(10n ** 18n)
        : JSON.stringify(call.params).includes(usdt)
          ? hex(25_000_000n)
          : hex(0n),
    );
    const { assets, unavailableChainIds } = await new EvmAssetClient({}, fetcher).assets(user);
    expect(unavailableChainIds).toEqual([]);
    for (const [, init] of fetcher.mock.calls)
      expect(JSON.parse(String(init?.body)).length).toBeLessThanOrEqual(10);
    const arbitrumEth = assets.find((asset) => asset.chainId === 42161 && asset.native);
    expect(arbitrumEth?.spendableRaw).toBe(
      (10n ** 18n - (EVM_SWAP_CHAINS[42161]?.gasReserve ?? 0n)).toString(),
    );
    expect(assets.find((asset) => asset.address === usdt)).toMatchObject({
      symbol: "USDT0",
      rawBalance: "25000000",
      usdc: false,
    });
    expect(assets.filter((asset) => !asset.native).every((asset) => asset.rawBalance !== "0")).toBe(
      true,
    );
  });

  it("keeps working when one chain's RPC is down", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).includes("base.org")
        ? new Response("down", { status: 503 })
        : rpc(() => hex(10n ** 18n))(url, init),
    );
    const { assets, unavailableChainIds } = await new EvmAssetClient({}, fetcher).assets(user);
    expect(unavailableChainIds).toEqual([8453]);
    expect(assets.some((asset) => asset.chainId === 8453)).toBe(false);
    expect(assets.some((asset) => asset.chainId === 1)).toBe(true);
  });

  it("looks up any ERC-20 by address, including bytes32 symbols", async () => {
    const abiString = `0x${"20".padStart(64, "0")}${"4".padStart(64, "0")}${Buffer.from("PEPE").toString("hex").padEnd(64, "0")}`;
    const fetcher = rpc((call) => {
      const data = (call.params[0] as { data: string }).data;
      if (data === "0x95d89b41") return abiString;
      if (data === "0x313ce567") return hex(18n);
      return hex(5n * 10n ** 18n);
    });
    const token = await new EvmAssetClient({}, fetcher).lookup(
      1,
      "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
      user,
    );
    expect(token).toMatchObject({
      symbol: "PEPE",
      decimals: 18,
      rawBalance: "5000000000000000000",
    });
    expect(decodeSymbol(`0x${Buffer.from("MKR").toString("hex").padEnd(64, "0")}`)).toBe("MKR");
    await expect(
      new EvmAssetClient(
        {},
        rpc(() => "0x"),
      ).lookup(1, usdt, user),
    ).rejects.toThrow(/not a token/);
  });
});

describe("Relay swap into USDC", () => {
  it("quotes any token with an approval step, refunds to the sender, and skips empty steps", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(relayQuote()));
    vi.stubGlobal("fetch", fetcher);
    const quote = await new RelayBridgeClient().swapQuote(swap);
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(sent).toMatchObject({
      originCurrency: usdt,
      destinationCurrency: solanaUsdc,
      amount: "50000000",
      refundTo: user,
      tradeType: "EXACT_INPUT",
    });
    expect(quote.steps.map((step) => step.id)).toEqual(["approve", "deposit"]);
    expect(quote).toMatchObject({
      outputAmountUsdc: "49.899898",
      minimumOutputUsdc: "48.901900",
      originSymbol: "USDT0",
      originGasRaw: "1800000000000",
      swapImpactPct: -0.01,
    });
  });

  it("rejects quotes for the wrong token, too much price impact, or fees that eat the swap", async () => {
    const reject = async (payload: unknown, message: RegExp) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
      await expect(new RelayBridgeClient().swapQuote(swap)).rejects.toThrow(message);
    };
    await reject(
      relayQuote({}, { currencyOut: { amount: "1", currency: { address: usdt, decimals: 6 } } }),
      /unexpected destination token/,
    );
    await reject(
      relayQuote({}, { currencyIn: { amount: "1", currency: { address: usdt, decimals: 6 } } }),
      /different token or amount/,
    );
    await reject(relayQuote({}, { swapImpact: { percent: "-2.5" } }), /more than 2%/);
    await reject(relayQuote({}, { totalImpact: { percent: "-12" } }), /more than 10%/);
    await reject(
      relayQuote({
        steps: [
          {
            id: "authorize",
            kind: "signature",
            requestId: `0x${"b".repeat(64)}`,
            items: [{ data: { from: user, to: user, data: "0x", value: "0", chainId: 42161 } }],
          },
        ],
      }),
      /wallet actions/,
    );
  });

  it("refuses to swap USDC into the same chain's USDC", () => {
    expect(
      EvmSwapQuoteInput.safeParse({
        ...swap,
        originChainId: 999,
        destinationChainId: 999,
        originCurrency: EVM_SWAP_CHAINS[999]?.usdc,
        recipient: user,
      }).success,
    ).toBe(false);
  });
});

describe("EVM swap checks", () => {
  function service(
    balances: { token: bigint; native: bigint },
    quote = relayQuote(),
    max = 10_000,
  ) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(quote)));
    const assets = {
      balance: vi.fn(async (_chain: number, token: string) =>
        token === NATIVE_TOKEN ? balances.native : balances.token,
      ),
      nativeBalance: vi.fn(async () => balances.native),
    } as unknown as EvmAssetClient;
    return new EvmSwapService(new RelayBridgeClient(), assets, max);
  }

  it("quotes when the wallet holds the token and enough gas", async () => {
    await expect(
      service({ token: 50_000_000n, native: 10n ** 15n }).quote(swap),
    ).resolves.toMatchObject({ outputAmountUsdc: "49.899898", originChain: "Arbitrum" });
  });

  it("checks the balance before asking Relay for a route", async () => {
    const swapService = service({ token: 1n, native: 10n ** 15n });
    await expect(swapService.quote(swap)).rejects.toThrow(/does not have enough/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks for gas when the wallet cannot pay for the approval and swap", async () => {
    await expect(service({ token: 50_000_000n, native: 0n }).quote(swap)).rejects.toThrow(
      /Add a little ETH on Arbitrum/,
    );
    await expect(service({ token: 50_000_000n, native: 1000n }).quote(swap)).rejects.toThrow(
      /Add a little ETH on Arbitrum/,
    );
  });

  it("keeps gas back when swapping the native token itself", async () => {
    const native = relayQuote(
      {},
      {
        currencyIn: {
          amount: "1000000000000000",
          currency: { chainId: 42161, address: NATIVE_TOKEN, symbol: "ETH", decimals: 18 },
        },
      },
    );
    const input = { ...swap, originCurrency: NATIVE_TOKEN, amount: "1000000000000000" };
    await expect(
      service({ token: 0n, native: 1_000_000_000_001_000n }, native).quote(input),
    ).rejects.toThrow(/Leave some ETH/);
  });

  it("enforces the swap cap on the USDC returned", async () => {
    const error = await service({ token: 50_000_000n, native: 10n ** 15n }, relayQuote(), 20)
      .quote(swap)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BridgeUnavailable);
    expect((error as BridgeUnavailable).message).toMatch(/limited to \$20/);
  });
});
