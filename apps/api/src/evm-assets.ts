import { z } from "zod";

export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
const EvmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const Hex = z.string().regex(/^0x[a-fA-F0-9]*$/);

type Token = { address: string; symbol: string; decimals: number };
export type EvmSwapChain = {
  name: string;
  rpcUrl: string;
  native: { symbol: string; decimals: number };
  /** Native balance held back for the approval and swap transactions when converting gas tokens. */
  gasReserve: bigint;
  usdc: string;
  tokens: readonly Token[];
};

/**
 * EVM chains a Sisera embedded wallet can be funded on, with the tokens people most often deposit
 * there. Any other ERC-20 can still be swapped by contract address through `lookup`.
 */
export const EVM_SWAP_CHAINS: Record<number, EvmSwapChain> = {
  1: {
    name: "Ethereum",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    native: { symbol: "ETH", decimals: 18 },
    gasReserve: 3_000_000_000_000_000n,
    usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    tokens: [
      { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 },
      { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", decimals: 6 },
      { address: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", decimals: 18 },
      { address: "0x6c3ea9036406852006290770bedfcaba0e23a0e8", symbol: "PYUSD", decimals: 6 },
      { address: "0x4c9edd5852cd905f086c759e8383e09bff1e68b3", symbol: "USDe", decimals: 18 },
      { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18 },
      { address: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", symbol: "wstETH", decimals: 18 },
      { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", symbol: "WBTC", decimals: 8 },
      { address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", symbol: "cbBTC", decimals: 8 },
      { address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", symbol: "UNI", decimals: 18 },
      { address: "0x514910771af9ca656af840dff83e8264ecf986ca", symbol: "LINK", decimals: 18 },
    ],
  },
  8453: {
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    native: { symbol: "ETH", decimals: 18 },
    gasReserve: 200_000_000_000_000n,
    usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    tokens: [
      { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 },
      { address: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", symbol: "USDbC", decimals: 6 },
      { address: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", symbol: "USDT", decimals: 6 },
      { address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", symbol: "DAI", decimals: 18 },
      { address: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", symbol: "EURC", decimals: 6 },
      { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
      { address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", symbol: "cbBTC", decimals: 8 },
      { address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631", symbol: "AERO", decimals: 18 },
    ],
  },
  42161: {
    name: "Arbitrum",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    native: { symbol: "ETH", decimals: 18 },
    gasReserve: 200_000_000_000_000n,
    usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    tokens: [
      { address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", symbol: "USDC", decimals: 6 },
      { address: "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8", symbol: "USDC.e", decimals: 6 },
      { address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", symbol: "USDT0", decimals: 6 },
      { address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", symbol: "DAI", decimals: 18 },
      { address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", symbol: "WETH", decimals: 18 },
      { address: "0x5979d7b546e38e414f7e9822514be443a4800529", symbol: "wstETH", decimals: 18 },
      { address: "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", symbol: "WBTC", decimals: 8 },
      { address: "0x912ce59144191c1204e64559fe8253a0e49e6548", symbol: "ARB", decimals: 18 },
      { address: "0xf97f4df75117a78c1a5a0dbb814af92458539fb4", symbol: "LINK", decimals: 18 },
    ],
  },
  10: {
    name: "Optimism",
    rpcUrl: "https://mainnet.optimism.io",
    native: { symbol: "ETH", decimals: 18 },
    gasReserve: 200_000_000_000_000n,
    usdc: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    tokens: [
      { address: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", symbol: "USDC", decimals: 6 },
      { address: "0x7f5c764cbc14f9669b88837ca1490cca17c31607", symbol: "USDC.e", decimals: 6 },
      { address: "0x01bff41798a0bcf287b996046ca68b395dbc1071", symbol: "USDT0", decimals: 6 },
      { address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", symbol: "DAI", decimals: 18 },
      { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
      { address: "0x68f180fcce6836688e9084f035309e29bf0a2095", symbol: "WBTC", decimals: 8 },
      { address: "0x4200000000000000000000000000000000000042", symbol: "OP", decimals: 18 },
    ],
  },
  137: {
    name: "Polygon",
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    native: { symbol: "POL", decimals: 18 },
    gasReserve: 200_000_000_000_000_000n,
    usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    tokens: [
      { address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", symbol: "USDC", decimals: 6 },
      { address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", symbol: "USDC.e", decimals: 6 },
      { address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", symbol: "USDT0", decimals: 6 },
      { address: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", symbol: "DAI", decimals: 18 },
      { address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", symbol: "WPOL", decimals: 18 },
      { address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", symbol: "WETH", decimals: 18 },
      { address: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", symbol: "WBTC", decimals: 8 },
    ],
  },
  56: {
    name: "BNB Chain",
    rpcUrl: "https://bsc-rpc.publicnode.com",
    native: { symbol: "BNB", decimals: 18 },
    gasReserve: 1_000_000_000_000_000n,
    usdc: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    tokens: [
      { address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", symbol: "USDC", decimals: 18 },
      { address: "0x55d398326f99059ff775485246999027b3197955", symbol: "USDT", decimals: 18 },
      { address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", symbol: "WBNB", decimals: 18 },
      { address: "0x2170ed0880ac9a755fd29b2688956bd959f933f8", symbol: "ETH", decimals: 18 },
      { address: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", symbol: "BTCB", decimals: 18 },
    ],
  },
  999: {
    name: "HyperEVM",
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    native: { symbol: "HYPE", decimals: 18 },
    gasReserve: 10_000_000_000_000_000n,
    usdc: "0xb88339cb7199b77e23db6e890353e22632ba630f",
    tokens: [
      { address: "0xb88339cb7199b77e23db6e890353e22632ba630f", symbol: "USDC", decimals: 6 },
      { address: "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb", symbol: "USDT0", decimals: 6 },
      { address: "0x5555555555555555555555555555555555555555", symbol: "WHYPE", decimals: 18 },
      { address: "0xfd739d4e423301ce9385c1fb8850539d657c296d", symbol: "kHYPE", decimals: 18 },
      { address: "0x9fdbda0a5e284c32744d2f17ee5c74b284993463", symbol: "UBTC", decimals: 8 },
      { address: "0xbe6727b535545c67d5caa73dea54865b92cf7907", symbol: "UETH", decimals: 18 },
      { address: "0x068f321fa8fb9f0d135f290ef6a3e2813e1c8a29", symbol: "USOL", decimals: 9 },
      { address: "0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e", symbol: "PURR", decimals: 18 },
    ],
  },
};

export type EvmAsset = {
  chainId: number;
  chain: string;
  address: string;
  symbol: string;
  decimals: number;
  rawBalance: string;
  /** What can be swapped: the full token balance, or native balance minus the gas reserve. */
  spendableRaw: string;
  native: boolean;
  usdc: boolean;
};

const word = (address: string) => address.slice(2).toLowerCase().padStart(64, "0");
const BALANCE_OF = "0x70a08231";
const DECIMALS = "0x313ce567";
const SYMBOL = "0x95d89b41";

/** Decodes an ABI `string` return value, or the `bytes32` symbols some older tokens use. */
export function decodeSymbol(hex: string) {
  const data = hex.slice(2);
  const text = (bytes: string) =>
    Buffer.from(bytes, "hex")
      .toString("utf8")
      .replace(/\0+$/, "")
      .replace(/[^\x20-\x7E -￿]/g, "")
      .trim();
  if (data.length === 64) return text(data);
  if (data.length < 128) return "";
  const length = Number.parseInt(data.slice(64, 128), 16);
  return Number.isSafeInteger(length) && length <= 64
    ? text(data.slice(128, 128 + length * 2))
    : "";
}

export class EvmAssetUnavailable extends Error {}

/** Reads EVM wallet balances straight from public chain RPCs. */
export class EvmAssetClient {
  private readonly cache = new Map<
    string,
    { until: number; value: Promise<{ assets: EvmAsset[]; unavailableChainIds: number[] }> }
  >();

  constructor(
    private readonly rpcOverrides: Record<number, string> = {},
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  private chain(chainId: number) {
    const chain = EVM_SWAP_CHAINS[chainId];
    if (!chain) throw new EvmAssetUnavailable("This chain is not supported for swaps.");
    return chain;
  }

  /**
   * Sends calls as JSON-RPC batches and returns their results in order. Batches stay at ten calls,
   * the smallest limit among the public RPCs used here.
   */
  private async rpc(chainId: number, calls: Array<{ method: string; params: unknown[] }>) {
    const url = this.rpcOverrides[chainId] ?? this.chain(chainId).rpcUrl;
    const batches: Array<typeof calls> = [];
    for (let index = 0; index < calls.length; index += 10)
      batches.push(calls.slice(index, index + 10));
    const results = await Promise.all(
      batches.map(async (batch) => {
        const response = await this.fetcher(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch.map((call, id) => ({ jsonrpc: "2.0", id, ...call }))),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok)
          throw new EvmAssetUnavailable(`RPC for chain ${chainId} returned ${response.status}`);
        const payload = z
          .array(
            z.object({ id: z.number(), result: Hex.optional(), error: z.unknown().optional() }),
          )
          .parse(await response.json());
        const byId = new Map(payload.map((item) => [item.id, item]));
        return batch.map((_, id) => {
          const item = byId.get(id);
          return item?.result && !item.error ? item.result : null;
        });
      }),
    );
    return results.flat();
  }

  async nativeBalance(chainId: number, owner: string) {
    const [result] = await this.rpc(chainId, [
      { method: "eth_getBalance", params: [EvmAddress.parse(owner), "latest"] },
    ]);
    if (result == null) throw new EvmAssetUnavailable("Native balance is unavailable.");
    return BigInt(result);
  }

  /** Balance of a native token (zero address) or ERC-20, in its smallest unit. */
  async balance(chainId: number, token: string, owner: string) {
    if (token.toLowerCase() === NATIVE_TOKEN) return this.nativeBalance(chainId, owner);
    const [result] = await this.rpc(chainId, [
      {
        method: "eth_call",
        params: [
          { to: EvmAddress.parse(token), data: `${BALANCE_OF}${word(EvmAddress.parse(owner))}` },
          "latest",
        ],
      },
    ]);
    if (result == null || result === "0x")
      throw new EvmAssetUnavailable("Token balance is unavailable.");
    return BigInt(result);
  }

  private async chainAssets(chainId: number, owner: string): Promise<EvmAsset[]> {
    const chain = this.chain(chainId);
    const results = await this.rpc(chainId, [
      { method: "eth_getBalance", params: [owner, "latest"] },
      ...chain.tokens.map((token) => ({
        method: "eth_call",
        params: [{ to: token.address, data: `${BALANCE_OF}${word(owner)}` }, "latest"],
      })),
    ]);
    const assets: EvmAsset[] = [];
    const native = results[0] == null ? null : BigInt(results[0]);
    if (native != null && native > 0n) {
      const spendable = native - chain.gasReserve;
      assets.push({
        chainId,
        chain: chain.name,
        address: NATIVE_TOKEN,
        symbol: chain.native.symbol,
        decimals: chain.native.decimals,
        rawBalance: native.toString(),
        spendableRaw: (spendable > 0n ? spendable : 0n).toString(),
        native: true,
        usdc: false,
      });
    }
    chain.tokens.forEach((token, index) => {
      const result = results[index + 1];
      const balance = result && result !== "0x" ? BigInt(result) : 0n;
      if (balance <= 0n) return;
      assets.push({
        chainId,
        chain: chain.name,
        address: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
        rawBalance: balance.toString(),
        spendableRaw: balance.toString(),
        native: false,
        usdc: token.address === chain.usdc,
      });
    });
    return assets;
  }

  /** Every non-zero curated balance across supported chains. Chains whose RPC fails are skipped. */
  async assets(owner: string) {
    const address = EvmAddress.parse(owner).toLowerCase();
    const cached = this.cache.get(address);
    if (cached && cached.until > Date.now()) return cached.value;
    const value = Promise.allSettled(
      Object.keys(EVM_SWAP_CHAINS).map((id) => this.chainAssets(Number(id), address)),
    ).then((results) => {
      const unavailable = Object.keys(EVM_SWAP_CHAINS)
        .map(Number)
        .filter((_, index) => results[index]?.status === "rejected");
      if (unavailable.length === results.length)
        throw new EvmAssetUnavailable("EVM balances are unavailable.");
      return {
        assets: results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
        unavailableChainIds: unavailable,
      };
    });
    this.cache.set(address, { until: Date.now() + 15_000, value });
    value.catch(() => this.cache.delete(address));
    return value;
  }

  /** Reads any ERC-20 by contract address, so long-tail tokens can be swapped too. */
  async lookup(chainId: number, tokenAddress: string, owner: string): Promise<EvmAsset> {
    const chain = this.chain(chainId);
    const token = EvmAddress.parse(tokenAddress).toLowerCase();
    if (token === NATIVE_TOKEN)
      throw new EvmAssetUnavailable("Choose the native token from the list.");
    const [symbol, decimals, balance] = await this.rpc(chainId, [
      { method: "eth_call", params: [{ to: token, data: SYMBOL }, "latest"] },
      { method: "eth_call", params: [{ to: token, data: DECIMALS }, "latest"] },
      {
        method: "eth_call",
        params: [{ to: token, data: `${BALANCE_OF}${word(EvmAddress.parse(owner))}` }, "latest"],
      },
    ]);
    const parsedDecimals = decimals && decimals !== "0x" ? Number(BigInt(decimals)) : Number.NaN;
    if (!Number.isInteger(parsedDecimals) || parsedDecimals > 36 || !balance || balance === "0x")
      throw new EvmAssetUnavailable("This address is not a token on the selected chain.");
    const raw = BigInt(balance).toString();
    return {
      chainId,
      chain: chain.name,
      address: token,
      symbol: (symbol && decodeSymbol(symbol)) || `${token.slice(0, 6)}…`,
      decimals: parsedDecimals,
      rawBalance: raw,
      spendableRaw: raw,
      native: false,
      usdc: token === chain.usdc,
    };
  }
}
