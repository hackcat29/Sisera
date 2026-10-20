import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_CHAINS, DESTINATION_USDC, RelayBridgeClient } from "../src/bridge.js";
import { EVM_SWAP_CHAINS } from "../src/evm-assets.js";

const user = "0x03508bb71268bba25ecacc8f620e01866650532c";
const solana = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
afterEach(() => vi.unstubAllGlobals());

describe("Relay bridge boundary", () => {
  it("quotes native USDC to Solana with exact atomic units and user-bound transactions", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        steps: [
          {
            kind: "transaction",
            requestId: `0x${"a".repeat(64)}`,
            items: [{ data: { from: user, to: user, data: "0x1234", value: "0", chainId: 8453 } }],
          },
        ],
        fees: { relayer: { amountUsd: "0.25" } },
        details: {
          currencyOut: { amount: "24750000", currency: { address: solana, decimals: 6 } },
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const quote = await new RelayBridgeClient().quote({
      originChainId: 8453,
      destinationChainId: 792703809,
      user,
      recipient: solana,
      amountUsdc: "25",
    });
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(sent.amount).toBe("25000000");
    expect(sent.usePermit).toBe(false);
    expect(sent.destinationCurrency).toBe(solana);
    expect(quote.outputAmountUsdc).toBe("24.750000");
  });

  it("rejects a quote that signs from another wallet or chain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          steps: [
            {
              kind: "transaction",
              requestId: `0x${"a".repeat(64)}`,
              items: [{ data: { from: user, to: user, data: "0x", value: "0", chainId: 1 } }],
            },
          ],
          details: {
            currencyOut: {
              amount: "1000000",
              currency: { address: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", decimals: 6 },
            },
          },
        }),
      ),
    );
    await expect(
      new RelayBridgeClient().quote({
        originChainId: 8453,
        destinationChainId: 999,
        user,
        recipient: user,
        amountUsdc: "10",
      }),
    ).rejects.toThrow("wallet actions");
  });

  it("only hard-codes well-formed token addresses", () => {
    // A Base USDC address missing one character once broke every bridge from Base.
    const evm = /^0x[0-9a-fA-F]{40}$/;
    for (const chain of Object.values(BRIDGE_CHAINS)) expect(chain.usdc).toMatch(evm);
    expect(DESTINATION_USDC[999]).toMatch(evm);
    for (const chain of Object.values(EVM_SWAP_CHAINS)) {
      expect(chain.usdc).toMatch(evm);
      for (const token of chain.tokens) expect(token.address).toMatch(evm);
    }
    // Each bridge chain's USDC is the same token the swap lists for that chain.
    for (const [id, chain] of Object.entries(BRIDGE_CHAINS))
      expect(chain.usdc.toLowerCase()).toBe(EVM_SWAP_CHAINS[Number(id)]?.usdc);
  });
});
