import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { SolanaWithdrawalService } from "../src/solana-withdraw.js";

const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const LAMPORTS = 1_000_000_000;

function setup(options: {
  lamports?: number;
  usdc?: string;
  existing?: PublicKey[];
  tokenAccounts?: PublicKey[];
  simulationError?: unknown;
}) {
  const owner = Keypair.generate();
  const destination = Keypair.generate().publicKey;
  const source = getAssociatedTokenAddressSync(USDC, owner.publicKey);
  const existing = new Map(
    (options.existing ?? []).map((key) => [key.toBase58(), { owner: SystemProgram.programId }]),
  );
  for (const key of options.tokenAccounts ?? [])
    existing.set(key.toBase58(), { owner: TOKEN_PROGRAM_ID });
  const connection = {
    getBalance: vi.fn(async () => options.lamports ?? LAMPORTS),
    getAccountInfo: vi.fn(async (key: PublicKey) => {
      const found = existing.get(key.toBase58());
      return found ? { ...found, executable: false, lamports: 1, data: Buffer.alloc(0) } : null;
    }),
    getParsedAccountInfo: vi.fn(async () => ({
      value: {
        owner: TOKEN_PROGRAM_ID,
        data: { program: "spl-token", parsed: { type: "mint", info: { decimals: 6 } }, space: 82 },
      },
    })),
    getParsedTokenAccountsByOwner: vi.fn(async () => ({
      value: [
        {
          pubkey: source,
          account: { data: { parsed: { info: { tokenAmount: { amount: options.usdc ?? "0" } } } } },
        },
      ],
    })),
    getMinimumBalanceForRentExemption: vi.fn(async (size: number) =>
      size === 0 ? 890_880 : 2_039_280,
    ),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 1,
    })),
    simulateTransaction: vi.fn(async () => ({ value: { err: options.simulationError ?? null } })),
    sendRawTransaction: vi.fn(async () => "signature-1"),
    confirmTransaction: vi.fn(async () => ({ value: { err: null } })),
  };
  const service = new SolanaWithdrawalService(
    "http://unused",
    connection as unknown as ConstructorParameters<typeof SolanaWithdrawalService>[1],
  );
  return { service, connection, owner, destination, source };
}

const instructions = (base64: string) => {
  const message = VersionedTransaction.deserialize(Buffer.from(base64, "base64")).message;
  return message.compiledInstructions.map((instruction) => ({
    program: message.staticAccountKeys[instruction.programIdIndex]?.toBase58(),
    accounts: instruction.accountKeyIndexes.map((index) =>
      message.staticAccountKeys[index]?.toBase58(),
    ),
    data: Buffer.from(instruction.data),
  }));
};

describe("Solana withdrawals", () => {
  it("sends all spendable SOL with Max, leaving exactly the network fee", async () => {
    const { service, owner, destination } = setup({});
    const prepared = await service.prepare({
      wallet: owner.publicKey.toBase58(),
      destination: destination.toBase58(),
      asset: "SOL",
      max: true,
    });
    expect(BigInt(prepared.amount) + BigInt(prepared.networkFeeLamports)).toBe(BigInt(LAMPORTS));
    const transfer = instructions(prepared.transaction).at(-1);
    expect(transfer?.program).toBe(SystemProgram.programId.toBase58());
    expect(transfer?.accounts).toEqual([owner.publicKey.toBase58(), destination.toBase58()]);
    expect(transfer?.data.readBigUInt64LE(4)).toBe(BigInt(prepared.amount));
  });

  it("refuses to strand a balance below Solana's rent minimum", async () => {
    const { service, owner, destination } = setup({});
    await expect(
      service.prepare({
        wallet: owner.publicKey.toBase58(),
        destination: destination.toBase58(),
        asset: "SOL",
        amount: String(LAMPORTS - 500_000),
      }),
    ).rejects.toThrow(/use Max/);
  });

  it("refuses its own address, token accounts and program addresses", async () => {
    const tokenAccount = Keypair.generate().publicKey;
    const { service, owner } = setup({ tokenAccounts: [tokenAccount] });
    const send = (destination: string) =>
      service.prepare({
        wallet: owner.publicKey.toBase58(),
        destination,
        asset: "SOL",
        amount: "100000000",
      });
    await expect(send(owner.publicKey.toBase58())).rejects.toThrow(/own address/);
    await expect(send(tokenAccount.toBase58())).rejects.toThrow(/token account/);
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("x")], SystemProgram.programId);
    await expect(send(pda.toBase58())).rejects.toThrow(/can't receive funds directly/);
  });

  it("opens the recipient's USDC account when needed and asks for the rent in SOL", async () => {
    const poor = setup({ lamports: 100_000, usdc: "25000000" });
    await expect(
      poor.service.prepare({
        wallet: poor.owner.publicKey.toBase58(),
        destination: poor.destination.toBase58(),
        asset: USDC.toBase58(),
        amount: "20000000",
      }),
    ).rejects.toThrow(/open this token's account/);

    const { service, owner, destination, source } = setup({ usdc: "25000000" });
    const prepared = await service.prepare({
      wallet: owner.publicKey.toBase58(),
      destination: destination.toBase58(),
      asset: USDC.toBase58(),
      amount: "20000000",
    });
    expect(prepared).toMatchObject({ createsRecipientAccount: true, decimals: 6 });
    const recipient = getAssociatedTokenAddressSync(USDC, destination).toBase58();
    const [create, transfer] = instructions(prepared.transaction).slice(2);
    expect(create?.program).toBe(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
    expect(create?.accounts.slice(0, 4)).toEqual([
      owner.publicKey.toBase58(),
      recipient,
      destination.toBase58(),
      USDC.toBase58(),
    ]);
    expect(transfer?.program).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(transfer?.accounts).toEqual([
      source.toBase58(),
      USDC.toBase58(),
      recipient,
      owner.publicKey.toBase58(),
    ]);
    expect(transfer?.data.readBigUInt64LE(1)).toBe(20_000_000n);
  });

  it("refuses more than the wallet holds and transfers that fail a test run", async () => {
    const short = setup({ usdc: "1000" });
    await expect(
      short.service.prepare({
        wallet: short.owner.publicKey.toBase58(),
        destination: short.destination.toBase58(),
        asset: USDC.toBase58(),
        amount: "20000000",
      }),
    ).rejects.toThrow(/does not hold that much/);
    const doomed = setup({ simulationError: { InstructionError: [2, "Custom"] } });
    await expect(
      doomed.service.prepare({
        wallet: doomed.owner.publicKey.toBase58(),
        destination: doomed.destination.toBase58(),
        asset: "SOL",
        amount: "100000000",
      }),
    ).rejects.toThrow(/test run/);
  });

  it("broadcasts only the reviewed transfer, signed by the wallet itself", async () => {
    const { service, connection, owner, destination } = setup({});
    const prepared = await service.prepare({
      wallet: owner.publicKey.toBase58(),
      destination: destination.toBase58(),
      asset: "SOL",
      amount: "100000000",
    });
    const sign = (base64: string, signer: Keypair) => {
      const transaction = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
      transaction.sign([signer]);
      return Buffer.from(transaction.serialize()).toString("base64");
    };
    const wallet = owner.publicKey.toBase58();
    const forged = VersionedTransaction.deserialize(
      Buffer.from(sign(prepared.transaction, owner), "base64"),
    );
    forged.signatures[0]?.fill(7);
    await expect(
      service.execute({
        wallet,
        transaction: prepared.transaction,
        signedTransaction: Buffer.from(forged.serialize()).toString("base64"),
      }),
    ).rejects.toThrow(/does not match/);

    const memo = new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner.publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [
          new TransactionInstruction({
            programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
            keys: [],
            data: Buffer.from("hi"),
          }),
        ],
      }).compileToV0Message(),
    );
    const memoBase64 = Buffer.from(memo.serialize()).toString("base64");
    await expect(
      service.execute({
        wallet,
        transaction: memoBase64,
        signedTransaction: sign(memoBase64, owner),
      }),
    ).rejects.toThrow(/not a withdrawal/);
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();

    await expect(
      service.execute({
        wallet,
        transaction: prepared.transaction,
        signedTransaction: sign(prepared.transaction, owner),
      }),
    ).resolves.toEqual({ signature: "signature-1", status: "confirmed" });
  });
});
