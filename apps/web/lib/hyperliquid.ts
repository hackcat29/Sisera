"use client";

import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { signL1Action } from "@nktkas/hyperliquid/signing";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const transport = new HttpTransport();
export const hyperliquidInfo = new InfoClient({ transport });
/** Named agents replace each other, so re-enabling on another device retires the old key. */
const AGENT_NAME = "Sisera";

type Address = `0x${string}`;
type StoredAgent = { privateKey: Address; address: Address };
export type PreparedAction = {
  action: Record<string, unknown>;
  nonce: number;
  expiresAfter: number;
};

const storageKey = (account: string) => `sisera:hyperliquid-agent:v1:${account.toLowerCase()}`;

/**
 * The trading key for `account` on this device. It is an agent wallet: it can place and cancel
 * orders on the user's Hyperliquid account, but it cannot withdraw or transfer funds.
 */
export function loadAgent(account: string): StoredAgent | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey(account)) ?? "null");
    if (stored && /^0x[0-9a-f]{64}$/i.test(stored.privateKey))
      return {
        privateKey: stored.privateKey,
        address: privateKeyToAccount(stored.privateKey).address,
      };
  } catch {
    // Storage can be unavailable in private windows; trading must then be enabled again.
  }
  return null;
}

function forgetAgent(account: string) {
  try {
    window.localStorage.removeItem(storageKey(account));
  } catch {
    // Nothing stored.
  }
}

/** A viem wallet client over the user's Privy wallet, for actions only the account owner signs. */
async function ownerWallet(wallet: ConnectedWallet) {
  const provider = await wallet.getEthereumProvider();
  return createWalletClient({ account: wallet.address as Address, transport: custom(provider) });
}

/**
 * Creates a trading key on this device and asks the user's wallet to approve it once. After this,
 * orders are signed by the trading key without further wallet prompts.
 */
export async function enableTrading(wallet: ConnectedWallet) {
  const privateKey = generatePrivateKey();
  const agent = privateKeyToAccount(privateKey);
  const exchange = new ExchangeClient({ wallet: await ownerWallet(wallet), transport });
  await exchange.approveAgent({ agentAddress: agent.address, agentName: AGENT_NAME });
  try {
    window.localStorage.setItem(
      storageKey(wallet.address),
      JSON.stringify({ privateKey, address: agent.address }),
    );
  } catch {
    throw new Error("This browser blocks storage, so trading cannot stay enabled here.");
  }
  return agent.address;
}

/** Whether this device's trading key is still approved on the account. */
export async function tradingEnabled(account: string) {
  const agent = loadAgent(account);
  if (!agent) return false;
  const agents = await hyperliquidInfo.extraAgents({ user: account as Address });
  const approved = agents.some(
    (item) =>
      item.address.toLowerCase() === agent.address.toLowerCase() &&
      (item.validUntil == null || item.validUntil > Date.now()),
  );
  if (!approved) forgetAgent(account);
  return approved;
}

/** Signs the exact actions Sisera prepared and risk-checked, with this device's trading key. */
export async function signPrepared(account: string, actions: readonly PreparedAction[]) {
  const agent = loadAgent(account);
  if (!agent) throw new Error("Enable trading on this device first.");
  const signer = privateKeyToAccount(agent.privateKey);
  const signatures = [];
  for (const prepared of actions)
    signatures.push(
      await signL1Action({
        wallet: signer,
        action: prepared.action,
        nonce: prepared.nonce,
        expiresAfter: prepared.expiresAfter,
      }),
    );
  return signatures;
}

/** Cancels a resting order. Cancelling only reduces risk, so it goes straight to the venue. */
export async function cancelOrder(account: string, asset: number, orderId: number) {
  const agent = loadAgent(account);
  if (!agent) throw new Error("Enable trading on this device first.");
  const exchange = new ExchangeClient({ wallet: privateKeyToAccount(agent.privateKey), transport });
  await exchange.cancel({ cancels: [{ a: asset, o: orderId }] });
}

/** Withdraws USDC from Hyperliquid to the account's own address on Arbitrum. */
export async function withdraw(wallet: ConnectedWallet, amountUsd: string) {
  const exchange = new ExchangeClient({ wallet: await ownerWallet(wallet), transport });
  await exchange.withdraw3({ destination: wallet.address as Address, amount: amountUsd });
}

export type PerpPosition = {
  coin: string;
  size: number;
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  liquidationPx: number | null;
  marginUsed: number;
  leverage: number;
  isCross: boolean;
};
export type OpenOrder = {
  coin: string;
  oid: number;
  side: "buy" | "sell";
  size: number;
  limitPx: number;
  triggerPx: number | null;
  orderType: string;
  reduceOnly: boolean;
  timestamp: number;
};
export type HyperliquidAccount = {
  accountValue: number;
  available: number;
  marginUsed: number;
  positions: PerpPosition[];
  openOrders: OpenOrder[];
  /** USDC sitting in the spot balance, which perps cannot use as margin until it is moved. */
  spotUsdc: number;
  assetIndex: Map<string, number>;
  updatedAt: number;
};

export type PerpMarketMeta = {
  index: number;
  maxLeverage: number;
  szDecimals: number;
  onlyIsolated: boolean;
};

let metaPromise: Promise<Map<string, PerpMarketMeta>> | null = null;
/** Every listed perpetual's asset index and limits, loaded once per page. */
function perpMeta() {
  metaPromise ??= hyperliquidInfo
    .meta()
    .then(
      (meta) =>
        new Map(
          meta.universe.map((asset, index) => [
            asset.name,
            {
              index,
              maxLeverage: asset.maxLeverage,
              szDecimals: asset.szDecimals,
              onlyIsolated: Boolean(asset.onlyIsolated),
            },
          ]),
        ),
    )
    .catch((error) => {
      metaPromise = null;
      throw error;
    });
  return metaPromise;
}

export function usePerpMarketMeta(coin: string) {
  const [meta, setMeta] = useState<PerpMarketMeta | null>(null);
  useEffect(() => {
    let active = true;
    void perpMeta()
      .then((markets) => {
        if (active) setMeta(markets.get(coin) ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [coin]);
  return meta;
}

/** Moves USDC from the Hyperliquid spot balance to perps, where it can be used as margin. */
export async function moveSpotToPerps(wallet: ConnectedWallet, amountUsd: string) {
  const exchange = new ExchangeClient({ wallet: await ownerWallet(wallet), transport });
  await exchange.usdClassTransfer({ amount: amountUsd, toPerp: true });
}

async function loadAccount(user: Address): Promise<HyperliquidAccount> {
  const [state, orders, spot, index] = await Promise.all([
    hyperliquidInfo.clearinghouseState({ user }),
    hyperliquidInfo.frontendOpenOrders({ user }),
    hyperliquidInfo.spotClearinghouseState({ user }).catch(() => null),
    perpMeta(),
  ]);
  return {
    accountValue: Number(state.marginSummary.accountValue),
    available: Number(state.withdrawable),
    marginUsed: Number(state.marginSummary.totalMarginUsed),
    positions: state.assetPositions.map(({ position }) => ({
      coin: position.coin,
      size: Number(position.szi),
      entryPx: Number(position.entryPx),
      positionValue: Number(position.positionValue),
      unrealizedPnl: Number(position.unrealizedPnl),
      returnOnEquity: Number(position.returnOnEquity),
      liquidationPx: position.liquidationPx == null ? null : Number(position.liquidationPx),
      marginUsed: Number(position.marginUsed),
      leverage: position.leverage.value,
      isCross: position.leverage.type === "cross",
    })),
    openOrders: orders.map((order) => ({
      coin: order.coin,
      oid: order.oid,
      side: order.side === "B" ? "buy" : "sell",
      size: Number(order.sz),
      limitPx: Number(order.limitPx),
      triggerPx: order.isTrigger ? Number(order.triggerPx) : null,
      orderType: order.orderType,
      reduceOnly: order.reduceOnly,
      timestamp: order.timestamp,
    })),
    spotUsdc: Number(spot?.balances.find((balance) => balance.coin === "USDC")?.total ?? 0),
    assetIndex: new Map([...index].map(([coin, meta]) => [coin, meta.index])),
    updatedAt: Date.now(),
  };
}

/** The account's Hyperliquid margin, positions and open orders, refreshed every few seconds. */
export function useHyperliquidAccount(address: string | null | undefined) {
  const [account, setAccount] = useState<HyperliquidAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const next = await loadAccount(address as Address);
      if (active.current) {
        setAccount(next);
        setError(null);
      }
    } catch {
      if (active.current) setError("Hyperliquid account data is reconnecting.");
    }
  }, [address]);

  useEffect(() => {
    active.current = true;
    setAccount(null);
    if (!address) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4000);
    const onTrade = () => void refresh();
    window.addEventListener("sisera:perp-trade", onTrade);
    return () => {
      active.current = false;
      window.clearInterval(timer);
      window.removeEventListener("sisera:perp-trade", onTrade);
    };
  }, [address, refresh]);

  return { account, error, refresh };
}

/** Tells every perps panel on the page to refresh after an order, cancel or deposit. */
export function announcePerpTrade() {
  window.dispatchEvent(new Event("sisera:perp-trade"));
}
