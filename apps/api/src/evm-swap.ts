import { BridgeUnavailable, EvmSwapQuoteInput, type RelayBridgeClient } from "./bridge.js";
import { EVM_SWAP_CHAINS, type EvmAssetClient, NATIVE_TOKEN } from "./evm-assets.js";

/**
 * Quotes a swap of any EVM token into USDC and checks it against the wallet before the user is
 * asked to sign: the balance must cover the amount, and the native token must cover Relay's gas
 * estimate for the approval and swap transactions.
 */
export class EvmSwapService {
  constructor(
    private readonly relay: RelayBridgeClient,
    private readonly assets: EvmAssetClient,
    private readonly maxOutputUsd: number,
  ) {}

  async quote(rawInput: unknown) {
    const input = EvmSwapQuoteInput.parse(rawInput);
    const chain = EVM_SWAP_CHAINS[input.originChainId];
    if (!chain) throw new BridgeUnavailable("This chain is not supported for swaps.", 422);
    const native = input.originCurrency === NATIVE_TOKEN;
    const amount = BigInt(input.amount);
    let balance: bigint;
    let nativeBalance: bigint;
    try {
      [balance, nativeBalance] = await Promise.all([
        this.assets.balance(input.originChainId, input.originCurrency, input.user),
        native ? Promise.resolve(0n) : this.assets.nativeBalance(input.originChainId, input.user),
      ]);
    } catch {
      throw new BridgeUnavailable("Wallet balances are unavailable. Try again shortly.");
    }
    if (balance < amount)
      throw new BridgeUnavailable("Your wallet does not have enough of this token.", 422);
    const gasAvailable = native ? balance - amount : nativeBalance;
    if (!native && gasAvailable === 0n)
      throw new BridgeUnavailable(
        `Add a little ${chain.native.symbol} on ${chain.name} for network fees.`,
        422,
      );

    const quote = await this.relay.swapQuote(input);
    const output = Number(quote.outputAmountUsdc);
    if (!(output >= 1))
      throw new BridgeUnavailable("This swap is too small. Swap at least $1.", 422);
    if (output > this.maxOutputUsd)
      throw new BridgeUnavailable(
        `Swaps are limited to $${this.maxOutputUsd.toLocaleString("en-US")} each. Swap a smaller amount.`,
        422,
      );
    if (quote.originGasRaw != null && gasAvailable < BigInt(quote.originGasRaw))
      throw new BridgeUnavailable(
        native
          ? `Leave some ${chain.native.symbol} for network fees. Swap a little less.`
          : `Add a little ${chain.native.symbol} on ${chain.name} for network fees.`,
        422,
      );
    return { ...quote, originChain: chain.name };
  }
}
