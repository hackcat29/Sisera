import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { JupiterOrderError, type JupiterQuoteClient } from "../src/jupiter.js";
import { USDC_MINT } from "../src/solana-convert.js";
import { SolanaGasTopUpService } from "../src/solana-gas-topup.js";

const SOL = "So11111111111111111111111111111111111111112";

function unsignedTransaction(payer: Keypair) {
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    ],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function setup(options: { usdc: string; order: (amount: string) => unknown }) {
  const wallet = Keypair.generate();
  const jupiter = {
    order: vi.fn(async (_input: string, _output: string, amount: string) => options.order(amount)),
    execute: vi.fn(async () => ({
      status: "Success" as const,
      signature: "sig-1",
      outputAmountResult: "14000000",
    })),
  };
  const helius = {
    getTokenBalance: vi.fn(async () => ({ rawBalance: options.usdc, decimals: 6 })),
  };
  const service = new SolanaGasTopUpService(
    jupiter as unknown as JupiterQuoteClient,
    helius as unknown as ConstructorParameters<typeof SolanaGasTopUpService>[1],
  );
  return { service, jupiter, wallet };
}

const order = (amount: string, outAmount = "14000000") => ({
  inputMint: USDC_MINT,
  outputMint: SOL,
  inAmount: amount,
  outAmount,
  requestId: `req-${amount}`,
  transaction: "unsigned",
});

describe("SOL top-up for network fees", () => {
  it("steps up to the smallest swap Jupiter will sponsor", async () => {
    const { service, jupiter, wallet } = setup({
      usdc: "50000000",
      order: (amount) => {
        if (amount === "2000000") throw new JupiterOrderError("too small", "metis", 3);
        return order(amount);
      },
    });
    const result = await service.prepare({
      wallet: wallet.publicKey.toBase58(),
      needsLamports: "1600000",
    });
    expect(result).toMatchObject({ usdcAmount: "5000000", requestId: "req-5000000" });
    // Never charges Sisera's referral fee here: Jupiter only sponsors gas without one.
    expect(jupiter.order).toHaveBeenLastCalledWith(
      USDC_MINT,
      SOL,
      "5000000",
      wallet.publicKey.toBase58(),
    );
  });

  it("skips quotes that would not cover the fee and never spends more USDC than held", async () => {
    const { service, jupiter, wallet } = setup({
      usdc: "6000000",
      order: (amount) => order(amount, "1000"),
    });
    await expect(
      service.prepare({ wallet: wallet.publicKey.toBase58(), needsLamports: "1600000" }),
    ).rejects.toThrow(/Add a little SOL/);
    expect(jupiter.order.mock.calls.map((call) => call[2])).toEqual(["2000000", "5000000"]);
  });

  it("asks for SOL when the wallet has too little USDC to swap", async () => {
    const { service, jupiter, wallet } = setup({ usdc: "500000", order: order });
    await expect(
      service.prepare({ wallet: wallet.publicKey.toBase58(), needsLamports: "1600000" }),
    ).rejects.toThrow(/at least \$2 of USDC/);
    expect(jupiter.order).not.toHaveBeenCalled();
  });

  it("refuses a quote for a different swap", async () => {
    const { service, wallet } = setup({
      usdc: "50000000",
      order: (amount) => ({ ...order(amount), outputMint: USDC_MINT }),
    });
    await expect(
      service.prepare({ wallet: wallet.publicKey.toBase58(), needsLamports: "1600000" }),
    ).rejects.toThrow(/did not match/);
  });

  it("executes only the swap the wallet signed", async () => {
    const { service, jupiter, wallet } = setup({ usdc: "50000000", order });
    const unsigned = unsignedTransaction(wallet);
    const transaction = Buffer.from(unsigned.serialize()).toString("base64");
    const signed = unsignedTransaction(wallet);
    signed.sign([wallet]);
    await expect(
      service.execute({
        wallet: wallet.publicKey.toBase58(),
        requestId: "req-1",
        transaction,
        signedTransaction: Buffer.from(signed.serialize()).toString("base64"),
      }),
    ).rejects.toThrow(/does not match/);
    expect(jupiter.execute).not.toHaveBeenCalled();

    unsigned.sign([wallet]);
    await expect(
      service.execute({
        wallet: wallet.publicKey.toBase58(),
        requestId: "req-1",
        transaction,
        signedTransaction: Buffer.from(unsigned.serialize()).toString("base64"),
      }),
    ).resolves.toEqual({ signature: "sig-1", solLamports: "14000000" });
  });
});
