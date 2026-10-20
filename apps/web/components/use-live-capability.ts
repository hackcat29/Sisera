"use client";

import { useEffect, useState } from "react";

type Venue = "solana" | "predictions" | "hyperliquid" | "launches" | "agents" | "delegatedSigning";
type Capabilities = {
  live?: Partial<Record<Venue, boolean>>;
  limits?: { perps?: { maxLeverage: number; maxNotionalUsd: number }; swapMaxUsd?: number };
  fees?: { hyperliquid?: { builder: string; perpBps: number; spotBps: number } | null };
};

function loadCapabilities(): Promise<Capabilities> {
  return fetch("/api/capabilities", { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<Capabilities>) : { live: {} }))
    .catch(() => ({ live: {} }));
}

export function useLiveCapability(venue: Venue): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () =>
      void loadCapabilities().then((capabilities) => {
        if (active) setEnabled(capabilities.live?.[venue] === true);
      });
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("sisera:session-renewed", update);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("sisera:session-renewed", update);
    };
  }, [venue]);
  return enabled;
}

/** Sisera's perpetual order limits, or conservative defaults until they load. */
export function usePerpLimits() {
  const [limits, setLimits] = useState({ maxLeverage: 20, maxNotionalUsd: 25_000 });
  useEffect(() => {
    let active = true;
    void loadCapabilities().then((capabilities) => {
      if (active && capabilities.limits?.perps) setLimits(capabilities.limits.perps);
    });
    return () => {
      active = false;
    };
  }, []);
  return limits;
}

export type HyperliquidFeeConfig = { builder: string; perpBps: number; spotBps: number };

/** Sisera's Hyperliquid builder fee, or null when it is not charged. */
export function useHyperliquidFee() {
  const [fee, setFee] = useState<HyperliquidFeeConfig | null>(null);
  useEffect(() => {
    let active = true;
    void loadCapabilities().then((capabilities) => {
      if (active) setFee(capabilities.fees?.hyperliquid ?? null);
    });
    return () => {
      active = false;
    };
  }, []);
  return fee;
}

/** The approval Hyperliquid needs for Sisera's highest fee, e.g. "1%". */
export function builderApproval(fee: HyperliquidFeeConfig | null) {
  return fee
    ? { builder: fee.builder, maxFeeRate: `${Math.max(fee.perpBps, fee.spotBps) / 100}%` }
    : null;
}

/** Like useLiveCapability, but undefined until capabilities have loaded, so a pending check is
 * not mistaken for "paused". */
export function useLiveCapabilityStatus(venue: Venue): boolean | undefined {
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const update = () =>
      void loadCapabilities().then((capabilities) => {
        if (active) setEnabled(capabilities.live?.[venue] === true);
      });
    update();
    const timer = window.setInterval(update, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [venue]);
  return enabled;
}
