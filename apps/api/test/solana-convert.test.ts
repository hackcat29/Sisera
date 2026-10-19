import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeliusClient } from "../src/helius.js";
import { JupiterOrderError, JupiterQuoteClient } from "../src/jupiter.js";
import {
  CONVERT_BOOK,
  NATIVE_SOL_MINT,
  SolanaConvertService,
  USDC_MINT,
} from "../src/solana-convert.js";
import { verifySignedSwap } from "../src/solana-trading.js";

const saveSolanaSwapOrder = vi.hoisted(() => vi.fn());
vi.mock("@sisera/db", () => ({ saveSolanaSwapOrder }));

const WALLET = Keypair.generate().publicKey.toBase58();
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function helius(overrides: Partial<Record<"lamports" | "raw", string>> = {}) {
  return {
    getSolLamports: vi.fn().mockResolvedValue(overrides.lamports ?? "0"),
    getTokenBalance: vi.fn().mockResolvedValue({ rawBalance: overrides.raw ?? "0", decimals: 5 }),
  } as unknown as HeliusClient;
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    inputMint: BONK,
    outputMint: USDC_MINT,
    inAmount: "100000000000",
    outAmount: "25000000",
    otherAmountThreshold: "24875000",
    priceImpact: 0.12,
    router: "metis",
    requestId: "req-1",
    transaction: "dW5zaWduZWQ=",
    gasless: true,
    feeBps: 20,
    slippageBps: 50,
    ...overrides,
  };
}

function service(options: {
  helius?: HeliusClient;
  order?: () => Promise<unknown>;
  tracked?: string | null;
  maxNotionalUsd?: number;
}) {
  const jupiter = {
    order: vi.fn(options.order ?? (async () => order())),
  } as unknown as JupiterQuoteClient;
  return {
    jupiter,
    convert: new SolanaConvertService({
      databaseUrl: "postgres://test",
      helius: options.helius ?? helius({ raw: "500000000000" }),
      jupiter,
      trackedAsset: async () => options.tracked ?? null,
      maxNotionalUsd: options.maxNotionalUsd ?? 10_000,
    }),
  };
}

const request = {
  subject: "privy:user",
  tenantId: "personal:user",
  wallet: WALLET,
  inputMint: BONK,
  amount: "100000000000",
};

beforeEach(() => saveSolanaSwapOrder.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("Solana swap into USDC", () => {
  it("routes any held token into USDC and books it outside trading positions", async () => {
    const { convert, jupiter } = service({});
    const prepared = await convert.prepare(request);
    expect(jupiter.order).toHaveBeenCalledWith(BONK, USDC_MINT, request.amount, WALLET, undefined);
    expect(prepared).toMatchObject({
      outAmount: "25000000",
      minOutAmount: "24875000",
      inputDecimals: 5,
      gasless: true,
      router: "metis",
    });
    expect(prepared.priceImpactPct).toBeCloseTo(0.12);
    const saved = saveSolanaSwapOrder.mock.calls[0]?.[1];
    expect(saved).toMatchObject({
      inputMint: BONK,
      outputMint: USDC_MINT,
      book: CONVERT_BOOK,
      tokenDecimals: 5,
      status: "prepared",
      mode: "live",
    });
    expect(saved.riskDecision.outcome).toBe("approved");
  });

  it("does not require SOL for fees, so Jupiter can sponsor gas for token-only wallets", async () => {
    const wallet = helius({ lamports: "0", raw: "500000000000" });
    const { convert } = service({ helius: wallet });
    await expect(convert.prepare(request)).resolves.toMatchObject({ gasless: true });
    expect(wallet.getSolLamports).not.toHaveBeenCalled();
  });

  it("keeps a SOL reserve for network fees when converting SOL itself", async () => {
    const wallet = helius({ lamports: "1000000000" });
    const { convert, jupiter } = service({
      helius: wallet,
      order: async () => order({ inputMint: NATIVE_SOL_MINT, inAmount: "990000000" }),
    });
    await expect(
      convert.prepare({ ...request, inputMint: NATIVE_SOL_MINT, amount: "990000001" }),
    ).rejects.toThrow(/keeps 0.01 SOL/);
    expect(jupiter.order).not.toHaveBeenCalled();
    await expect(
      convert.prepare({ ...request, inputMint: NATIVE_SOL_MINT, amount: "990000000" }),
    ).resolves.toMatchObject({ inputDecimals: 9 });
  });

  it("refuses USDC, unheld balances, and assets tracked as portfolio positions", async () => {
    await expect(service({}).convert.prepare({ ...request, inputMint: USDC_MINT })).rejects.toThrow(
      /already USDC/,
    );
    await expect(
      service({ helius: helius({ raw: "1" }) }).convert.prepare(request),
    ).rejects.toThrow(/does not have enough/);
    await expect(service({ tracked: "public_equity" }).convert.prepare(request)).rejects.toThrow(
      /market page/,
    );
    expect(saveSolanaSwapOrder).not.toHaveBeenCalled();
  });

  it("explains Jupiter build failures instead of a generic error", async () => {
    const fail = (code: number) => async () => {
      throw new JupiterOrderError("no tx", "metis", code);
    };
    await expect(service({ order: fail(3) }).convert.prepare(request)).rejects.toThrow(
      /too small to cover network fees/,
    );
    await expect(service({ order: fail(2) }).convert.prepare(request)).rejects.toThrow(
      /Add a little SOL/,
    );
    await expect(
      service({
        order: async () => {
          throw new Error("Jupiter order returned 400");
        },
      }).convert.prepare(request),
    ).rejects.toThrow(/No swap route/);
  });

  it("rejects quotes that change the request, move the price, or exceed the swap cap", async () => {
    await expect(
      service({ order: async () => order({ outputMint: BONK }) }).convert.prepare(request),
    ).rejects.toThrow(/did not match/);
    await expect(
      service({ order: async () => order({ priceImpact: 2.5 }) }).convert.prepare(request),
    ).rejects.toThrow(/more than 2%/);
    await expect(service({ maxNotionalUsd: 20 }).convert.prepare(request)).rejects.toThrow(
      /limited to \$20/,
    );
    expect(saveSolanaSwapOrder).not.toHaveBeenCalled();
  });
});

describe("Jupiter order client", () => {
  it("lets Jupiter choose slippage unless the caller sets it, and detects sponsored gas", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => order({ gasless: undefined, signatureFeePayer: "gasSponsor" }),
    });
    vi.stubGlobal("fetch", fetcher);
    const client = new JupiterQuoteClient("key");
    const result = await client.order(BONK, USDC_MINT, "1", WALLET);
    expect(new URL(fetcher.mock.calls[0]?.[0]).searchParams.has("slippageBps")).toBe(false);
    expect(result.gasless).toBe(true);
    await client.order(BONK, USDC_MINT, "1", WALLET, 75);
    expect(new URL(fetcher.mock.calls[1]?.[0]).searchParams.get("slippageBps")).toBe("75");
  });

  it("surfaces Jupiter's error code when it cannot build a transaction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => order({ transaction: "", errorCode: 3, errorMessage: "too small" }),
      }),
    );
    const error = await new JupiterQuoteClient("key")
      .order(BONK, USDC_MINT, "1", WALLET)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JupiterOrderError);
    expect((error as JupiterOrderError).belowGaslessMinimum).toBe(true);
  });

  it("accepts the user's signature when a gas sponsor is the fee payer", () => {
    const sponsor = Keypair.generate();
    const user = Keypair.generate();
    const message = new TransactionMessage({
      payerKey: sponsor.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message();
    const unsigned = new VersionedTransaction(message);
    const signed = new VersionedTransaction(message);
    signed.sign([user]);
    expect(() =>
      verifySignedSwap(
        Buffer.from(unsigned.serialize()).toString("base64"),
        Buffer.from(signed.serialize()).toString("base64"),
        user.publicKey.toBase58(),
      ),
    ).not.toThrow();
  });
});
