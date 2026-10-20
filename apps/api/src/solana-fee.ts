import {
  type AddressLookupTableAccount,
  type Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDC_DECIMALS = 6;
/** SPL Token's TransferChecked instruction. */
const TRANSFER_CHECKED = 12;

export function usdcAccountOf(owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), USDC_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

/** A USDC transfer of `amount` (in micro-USDC) from the owner's USDC account to `destination`. */
export function usdcTransfer(owner: PublicKey, destination: PublicKey, amount: bigint) {
  const data = Buffer.alloc(10);
  data.writeUInt8(TRANSFER_CHECKED, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(USDC_DECIMALS, 9);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: usdcAccountOf(owner), isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/**
 * Charges Sisera's fee on Solana transactions that have no native fee mechanism, by adding a USDC
 * transfer to Sisera's fee account before the user signs.
 *
 * A transaction is only changed when the user is its sole signer and nothing is signed yet, so no
 * other party's signature can be invalidated. Otherwise it is returned unchanged with no fee.
 */
export class SolanaFeeCollector {
  private destinationCheck: Promise<boolean> | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly options: { feeAccount: string; bps: number } | undefined,
  ) {}

  /** The configured fee account must be an existing USDC token account, checked once. */
  private destinationReady() {
    const feeAccount = this.options?.feeAccount;
    if (!feeAccount) return Promise.resolve(false);
    this.destinationCheck ??= this.connection
      .getAccountInfo(new PublicKey(feeAccount))
      .then(
        (info) =>
          info?.owner.equals(TOKEN_PROGRAM) === true &&
          info.data.length >= 32 &&
          new PublicKey(info.data.subarray(0, 32)).equals(USDC_MINT),
      )
      .catch(() => {
        this.destinationCheck = null;
        return false;
      });
    return this.destinationCheck;
  }

  /** The fee for a USDC amount (in micro-USDC), or 0 when fees are off. */
  feeFor(amount: bigint) {
    if (!this.options || this.options.bps <= 0) return 0n;
    return (amount * BigInt(Math.round(this.options.bps * 100))) / 1_000_000n;
  }

  async apply(transactionBase64: string, owner: string, amount: bigint) {
    const fee = this.feeFor(amount);
    const unchanged = { transaction: transactionBase64, feeMicroUsdc: 0n };
    if (fee <= 0n || !this.options || !(await this.destinationReady())) return unchanged;
    const transaction = VersionedTransaction.deserialize(Buffer.from(transactionBase64, "base64"));
    const { message } = transaction;
    const ownerKey = new PublicKey(owner);
    if (
      message.header.numRequiredSignatures !== 1 ||
      !message.staticAccountKeys[0]?.equals(ownerKey) ||
      transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))
    )
      return unchanged;
    const lookupTables = (
      await Promise.all(
        message.addressTableLookups.map((lookup) =>
          this.connection.getAddressLookupTable(lookup.accountKey),
        ),
      )
    )
      .map((result) => result.value)
      .filter((table): table is AddressLookupTableAccount => table != null);
    if (lookupTables.length !== message.addressTableLookups.length) return unchanged;
    const decompiled = TransactionMessage.decompile(message, {
      addressLookupTableAccounts: lookupTables,
    });
    decompiled.instructions.push(
      usdcTransfer(ownerKey, new PublicKey(this.options.feeAccount), fee),
    );
    const rebuilt = new VersionedTransaction(decompiled.compileToV0Message(lookupTables));
    return {
      transaction: Buffer.from(rebuilt.serialize()).toString("base64"),
      feeMicroUsdc: fee,
    };
  }
}
