import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { verifySignedSwap } from "./solana-trading.js";

/** Marks a withdrawal of native SOL rather than an SPL token. */
export const NATIVE_SOL = "SOL";
const COMPUTE_UNIT_PRICE = 50_000; // micro-lamports
const BASE_FEE_LAMPORTS = 5_000n;
/** Size of a plain SPL token account; Token-2022 accounts can be larger. */
const TOKEN_ACCOUNT_SIZE = 165;
/** Programs a withdrawal may call. Anything else in a signed transaction is refused. */
const ALLOWED_PROGRAMS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  SystemProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
]);

export class WithdrawalRejected extends Error {
  constructor(
    message: string,
    readonly status = 422,
    /** Set when the wallet only lacks SOL for fees, so the app can offer to buy some. */
    readonly needsLamports?: string,
  ) {
    super(message);
  }
}

const sol = (lamports: bigint) => (Number(lamports) / 1e9).toFixed(6).replace(/\.?0+$/, "");

function publicKey(value: string, label: string) {
  try {
    return new PublicKey(value);
  } catch {
    throw new WithdrawalRejected(`The ${label} is not a valid Solana address.`);
  }
}

type SolanaConnection = Pick<
  Connection,
  | "getBalance"
  | "getAccountInfo"
  | "getParsedAccountInfo"
  | "getParsedTokenAccountsByOwner"
  | "getMinimumBalanceForRentExemption"
  | "getLatestBlockhash"
  | "simulateTransaction"
  | "sendRawTransaction"
  | "confirmTransaction"
>;

/**
 * Sends SOL or any SPL token from a user's Sisera Solana wallet to an address they choose.
 * Sisera checks the destination and balances, builds the transfer and simulates it; the user's
 * wallet signs it, and Sisera broadcasts the signed copy only if it is the transfer it built.
 */
export class SolanaWithdrawalService {
  private readonly connection: SolanaConnection;

  constructor(rpcUrl: string, connection?: SolanaConnection) {
    this.connection = connection ?? new Connection(rpcUrl, "confirmed");
  }

  async prepare(input: {
    wallet: string;
    destination: string;
    asset: string;
    /** Raw amount in the token's smallest unit. Ignored for SOL when `max` is set. */
    amount?: string | undefined;
    /** Send all SOL the wallet can spend after the network fee. */
    max?: boolean | undefined;
  }) {
    const wallet = publicKey(input.wallet, "wallet");
    const destination = publicKey(input.destination, "destination");
    if (destination.equals(wallet))
      throw new WithdrawalRejected("That is this wallet's own address. Enter where to send it.");
    // Addresses off the ed25519 curve belong to programs; tokens sent there may be unrecoverable.
    if (!PublicKey.isOnCurve(destination.toBytes()))
      throw new WithdrawalRejected(
        "This address can't receive funds directly. Check that you copied a wallet address.",
      );
    const destinationInfo = await this.connection.getAccountInfo(destination);
    if (
      destinationInfo &&
      (destinationInfo.owner.equals(TOKEN_PROGRAM_ID) ||
        destinationInfo.owner.equals(TOKEN_2022_PROGRAM_ID))
    )
      throw new WithdrawalRejected(
        "This is a token account, not a wallet address. Use the recipient's wallet address.",
      );
    if (destinationInfo?.executable)
      throw new WithdrawalRejected("This address is a program, not a wallet.");

    const lamports = BigInt(await this.connection.getBalance(wallet, "confirmed"));
    return input.asset === NATIVE_SOL
      ? this.prepareSol(wallet, destination, lamports, destinationInfo != null, input)
      : this.prepareToken(wallet, destination, lamports, input.asset, input.amount);
  }

  private async prepareSol(
    wallet: PublicKey,
    destination: PublicKey,
    lamports: bigint,
    destinationExists: boolean,
    input: { amount?: string | undefined; max?: boolean | undefined },
  ) {
    const units = 2_000;
    const fee = BASE_FEE_LAMPORTS + BigInt(Math.ceil((units * COMPUTE_UNIT_PRICE) / 1e6));
    const amount = input.max ? lamports - fee : BigInt(input.amount ?? "0");
    if (amount <= 0n) throw new WithdrawalRejected("Enter an amount above zero.");
    const remaining = lamports - amount - fee;
    if (remaining < 0n)
      throw new WithdrawalRejected(
        `Not enough SOL. The network fee is about ${sol(fee)} SOL; the most you can send is ${sol(lamports - fee > 0n ? lamports - fee : 0n)} SOL.`,
      );
    const rentMinimum = BigInt(await this.connection.getMinimumBalanceForRentExemption(0));
    // Solana refuses to leave an account with a balance between zero and its rent minimum.
    if (remaining > 0n && remaining < rentMinimum)
      throw new WithdrawalRejected(
        `Send everything (use Max) or leave at least ${sol(rentMinimum)} SOL in your wallet.`,
      );
    if (!destinationExists && amount < rentMinimum)
      throw new WithdrawalRejected(
        `This address is new on Solana, so it needs at least ${sol(rentMinimum)} SOL.`,
      );
    const transaction = await this.build(wallet, units, [
      SystemProgram.transfer({ fromPubkey: wallet, toPubkey: destination, lamports: amount }),
    ]);
    return {
      transaction,
      asset: NATIVE_SOL,
      amount: amount.toString(),
      decimals: 9,
      networkFeeLamports: fee.toString(),
      accountRentLamports: "0",
      createsRecipientAccount: false,
    };
  }

  private async prepareToken(
    wallet: PublicKey,
    destination: PublicKey,
    lamports: bigint,
    asset: string,
    rawAmount: string | undefined,
  ) {
    const mint = publicKey(asset, "token");
    const amount = BigInt(rawAmount ?? "0");
    if (amount <= 0n) throw new WithdrawalRejected("Enter an amount above zero.");
    const mintInfo = await this.connection.getParsedAccountInfo(mint);
    const programId = mintInfo.value?.owner;
    const parsed = mintInfo.value?.data;
    if (
      !programId ||
      !(programId.equals(TOKEN_PROGRAM_ID) || programId.equals(TOKEN_2022_PROGRAM_ID)) ||
      !parsed ||
      !("parsed" in parsed) ||
      parsed.parsed?.type !== "mint"
    )
      throw new WithdrawalRejected("This token could not be found on Solana.");
    const decimals = Number(parsed.parsed.info.decimals);

    // Prefer the standard token account; fall back to any other account holding enough.
    const standard = getAssociatedTokenAddressSync(mint, wallet, false, programId);
    const accounts = (await this.connection.getParsedTokenAccountsByOwner(wallet, { mint })).value
      .map((item) => ({
        pubkey: item.pubkey,
        balance: BigInt(item.account.data.parsed?.info?.tokenAmount?.amount ?? "0"),
      }))
      .filter((item) => item.balance >= amount)
      .sort((a, b) => Number(b.pubkey.equals(standard)) - Number(a.pubkey.equals(standard)));
    const source = accounts[0];
    if (!source) throw new WithdrawalRejected("Your wallet does not hold that much of this token.");

    const recipientAccount = getAssociatedTokenAddressSync(mint, destination, false, programId);
    const createsRecipientAccount = !(await this.connection.getAccountInfo(recipientAccount));
    const rent = createsRecipientAccount
      ? BigInt(await this.connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE))
      : 0n;
    const units = createsRecipientAccount ? 60_000 : 30_000;
    const fee = BASE_FEE_LAMPORTS + BigInt(Math.ceil((units * COMPUTE_UNIT_PRICE) / 1e6));
    if (lamports < fee + rent)
      throw new WithdrawalRejected(
        createsRecipientAccount
          ? `Add about ${sol(fee + rent + 100_000n)} SOL to your wallet. Solana charges a network fee plus ${sol(rent)} SOL to open this token's account at the new address.`
          : `Add a little SOL (about ${sol(fee + 100_000n)}) to your wallet for the network fee.`,
        422,
        (fee + rent - lamports).toString(),
      );
    const transaction = await this.build(wallet, units, [
      ...(createsRecipientAccount
        ? [
            createAssociatedTokenAccountIdempotentInstruction(
              wallet,
              recipientAccount,
              destination,
              mint,
              programId,
            ),
          ]
        : []),
      createTransferCheckedInstruction(
        source.pubkey,
        mint,
        recipientAccount,
        wallet,
        amount,
        decimals,
        [],
        programId,
      ),
    ]);
    return {
      transaction,
      asset: mint.toBase58(),
      amount: amount.toString(),
      decimals,
      networkFeeLamports: fee.toString(),
      accountRentLamports: rent.toString(),
      createsRecipientAccount,
    };
  }

  /** Compiles the transfer and simulates it, so a doomed withdrawal is never put up for signing. */
  private async build(payer: PublicKey, units: number, instructions: TransactionInstruction[]) {
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }),
        ...instructions,
      ],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    const simulation = await this.connection.simulateTransaction(transaction, {
      sigVerify: false,
      commitment: "confirmed",
    });
    if (simulation.value.err)
      throw new WithdrawalRejected(
        "Solana rejected this transfer in a test run. Nothing was sent; check the amount and try again.",
      );
    return Buffer.from(transaction.serialize()).toString("base64");
  }

  async execute(input: { wallet: string; transaction: string; signedTransaction: string }) {
    const wallet = publicKey(input.wallet, "wallet");
    try {
      verifySignedSwap(input.transaction, input.signedTransaction, wallet.toBase58());
    } catch {
      throw new WithdrawalRejected(
        "Your wallet's signature does not match the withdrawal you reviewed. Review it again.",
      );
    }
    const message = VersionedTransaction.deserialize(
      Buffer.from(input.transaction, "base64"),
    ).message;
    const keys = message.staticAccountKeys;
    if (!keys[0]?.equals(wallet))
      throw new WithdrawalRejected("This withdrawal must be paid for by your own wallet.");
    if (
      message.addressTableLookups.length > 0 ||
      message.compiledInstructions.some(
        (instruction) => !ALLOWED_PROGRAMS.has(keys[instruction.programIdIndex]?.toBase58() ?? ""),
      )
    )
      throw new WithdrawalRejected("This is not a withdrawal Sisera prepared.");

    let signature: string;
    try {
      signature = await this.connection.sendRawTransaction(
        Buffer.from(input.signedTransaction, "base64"),
        { maxRetries: 3, skipPreflight: false },
      );
    } catch {
      throw new WithdrawalRejected(
        "The withdrawal could not be sent. Nothing left your wallet; review it and try again.",
      );
    }
    const confirmation = await this.connection
      .confirmTransaction(signature, "confirmed")
      .catch(() => null);
    return {
      signature,
      status: confirmation
        ? confirmation.value.err
          ? ("failed" as const)
          : ("confirmed" as const)
        : ("pending" as const),
    };
  }
}
