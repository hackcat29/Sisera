import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayBridgeClient, SOLANA_CHAIN_ID } from "../src/bridge.js";
import { SolanaFeeCollector, USDC_MINT, usdcAccountOf } from "../src/solana-fee.js";

afterEach(() => vi.unstubAllGlobals());

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const feeAccount = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();

/** A connection whose fee account is a USDC token account, or `owner`/`mint` as given. */
function connection(account: { owner?: PublicKey; mint?: PublicKey } = {}) {
  const data = Buffer.alloc(165);
  (account.mint ?? USDC_MINT).toBuffer().copy(data, 0);
  return {
    getAccountInfo: vi.fn().mockResolvedValue({ owner: account.owner ?? TOKEN_PROGRAM, data }),
    getAddressLookupTable: vi.fn(),
  } as never;
}

function transaction(payer: PublicKey, extraSigner?: Keypair) {
  const instructions = [
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 }),
  ];
  if (extraSigner)
    instructions.push(
      SystemProgram.transfer({ fromPubkey: extraSigner.publicKey, toPubkey: payer, lamports: 1 }),
    );
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(),
  );
  return Buffer.from(tx.serialize()).toString("base64");
}

describe("Solana fee collector", () => {
  it("derives USDC accounts exactly as the token program does", () => {
    // Read from mainnet: this wallet holds USDC in its associated token account.
    expect(
      usdcAccountOf(new PublicKey("EKFXPqGVdNZmhSsp143XjqBqnEXsauPVWf3o4VeF9BVJ")).toBase58(),
    ).toBe("11kzWyAwp9fG47nbgo47E2nKDxbi7hBwNcvDRbPFYk");
  });

  it("appends a USDC transfer of the fee to a transaction only the user signs", async () => {
    const user = Keypair.generate().publicKey;
    const collector = new SolanaFeeCollector(connection(), {
      feeAccount: feeAccount.toBase58(),
      bps: 100,
    });
    const charged = await collector.apply(transaction(user), user.toBase58(), 25_000_000n);
    expect(charged.feeMicroUsdc).toBe(250_000n);
    const tx = VersionedTransaction.deserialize(Buffer.from(charged.transaction, "base64"));
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    const transfer = tx.message.compiledInstructions.at(-1);
    const keys = tx.message.staticAccountKeys;
    expect(transfer && keys[transfer.programIdIndex]?.equals(TOKEN_PROGRAM)).toBe(true);
    expect(transfer?.accountKeyIndexes.map((index) => keys[index]?.toBase58())).toEqual([
      usdcAccountOf(user).toBase58(),
      USDC_MINT.toBase58(),
      feeAccount.toBase58(),
      user.toBase58(),
    ]);
    // TransferChecked: instruction 12, amount 250000, 6 decimals.
    expect(Buffer.from(transfer?.data ?? []).toString("hex")).toBe("0c90d003000000000006");
  });

  it("leaves transactions alone when another party must sign, or when fees are off or misconfigured", async () => {
    const user = Keypair.generate().publicKey;
    const cases = [
      { conn: connection(), tx: transaction(user, Keypair.generate()), bps: 100 },
      { conn: connection(), tx: transaction(user), bps: 0 },
      { conn: connection({ mint: Keypair.generate().publicKey }), tx: transaction(user), bps: 100 },
      { conn: connection({ owner: SystemProgram.programId }), tx: transaction(user), bps: 100 },
    ];
    for (const { conn, tx, bps } of cases) {
      const result = await new SolanaFeeCollector(conn, {
        feeAccount: feeAccount.toBase58(),
        bps,
      }).apply(tx, user.toBase58(), 25_000_000n);
      expect(result).toEqual({ transaction: tx, feeMicroUsdc: 0n });
    }
  });
});

describe("Relay app fees", () => {
  const quote = (output: string) =>
    Response.json({
      steps: [
        {
          id: "deposit",
          kind: "transaction",
          requestId: `0x${"d".repeat(64)}`,
          items: [
            {
              data: {
                from: "0x03508bb71268bba25ecacc8f620e01866650532c",
                to: "0x03508bb71268bba25ecacc8f620e01866650532c",
                data: "0x",
                value: "1",
                chainId: 8453,
              },
            },
          ],
        },
      ],
      details: {
        currencyIn: {
          amount: "10000000000000000",
          currency: { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
        },
        currencyOut: {
          amount: output,
          currency: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
        },
      },
    });
  const fees = {
    recipient: "0x2222222222222222222222222222222222222222",
    swapBps: 50,
    bridgeBps: 0,
  };
  const user = "0x03508bb71268bba25ecacc8f620e01866650532c";

  it("charges the swap fee on token swaps and nothing on plain USDC bridges by default", async () => {
    const fetcher = vi.fn().mockImplementation(async () => quote("24000000"));
    vi.stubGlobal("fetch", fetcher);
    const relay = new RelayBridgeClient(undefined, fees);
    await relay.swapQuote({
      originChainId: 8453,
      destinationChainId: SOLANA_CHAIN_ID,
      originCurrency: "0x0000000000000000000000000000000000000000",
      amount: "10000000000000000",
      user,
      recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).appFees).toEqual([
      { recipient: fees.recipient, fee: "50" },
    ]);
    await relay
      .quote({
        originChainId: 8453,
        destinationChainId: SOLANA_CHAIN_ID,
        user,
        recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        amountUsdc: "25",
      })
      .catch(() => undefined);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).appFees).toBeUndefined();
  });
});
