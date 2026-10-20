import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("local configuration", () => {
  it("accepts an unset optional Solana RPC URL from the example env file", () => {
    expect(readConfig({ SOLANA_RPC_URL: "" }).SOLANA_RPC_URL).toBeUndefined();
    expect(readConfig({}).SISERA_ALLOW_DEV_AUTH).toBe(false);
    expect(readConfig({}).SISERA_LIVE_HYPERLIQUID_ENABLED).toBe(true);
    expect(
      readConfig({ SISERA_LIVE_HYPERLIQUID_ENABLED: "false" }).SISERA_LIVE_HYPERLIQUID_ENABLED,
    ).toBe(false);
    expect(readConfig({}).SISERA_DELEGATED_SIGNING_ENABLED).toBe(true);
  });

  it("keeps fees off until a recipient is configured, and within each venue's limits", () => {
    const defaults = readConfig({});
    expect(defaults.SISERA_BUILDER_ADDRESS).toBeUndefined();
    expect(defaults.SISERA_JUPITER_REFERRAL_ACCOUNT).toBeUndefined();
    expect(defaults.SISERA_RELAY_FEE_RECIPIENT).toBeUndefined();
    expect(defaults.SISERA_BUILDER_FEE_PERP_BPS).toBe(10);
    expect(defaults.SISERA_BUILDER_FEE_SPOT_BPS).toBe(100);
    expect(defaults.SISERA_RELAY_BRIDGE_FEE_BPS).toBe(0);
    // Hyperliquid caps perp builder fees at 0.1%; Jupiter accepts 0.5%-2.55% or nothing.
    expect(() => readConfig({ SISERA_BUILDER_FEE_PERP_BPS: "100" })).toThrow();
    expect(() => readConfig({ SISERA_JUPITER_TRADE_FEE_BPS: "25" })).toThrow();
    expect(readConfig({ SISERA_JUPITER_TRADE_FEE_BPS: "0" }).SISERA_JUPITER_TRADE_FEE_BPS).toBe(0);
  });
});
