"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { arbitrum, base, bsc, hyperEvm, mainnet, optimism, polygon } from "viem/chains";

const DEFAULT_PRIVY_APP_ID = "cmuhawmmr00xa0bjwxxjqdocd";
/**
 * EVM chains the embedded wallet signs on for the bridge and Swap to USDC. Listed explicitly because
 * Privy's defaults omit BNB Chain and map chain 999 to a testnet rather than HyperEVM.
 */
const SUPPORTED_EVM_CHAINS = [mainnet, base, arbitrum, optimism, polygon, bsc, hyperEvm].map(
  (chain) => ({ ...chain, testnet: false }),
);

export function SiseraPrivyProvider({
  appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || DEFAULT_PRIVY_APP_ID,
  children,
}: { appId?: string | undefined; children: ReactNode }) {
  const activeAppId = appId || DEFAULT_PRIVY_APP_ID;
  return (
    <PrivyProvider
      appId={activeAppId}
      config={{
        supportedChains: SUPPORTED_EVM_CHAINS,
        defaultChain: { ...mainnet, testnet: false },
        loginMethods: ["email", "google", "twitter", "discord", "apple", "wallet", "passkey"],
        appearance: {
          theme: "dark",
          accentColor: "#e9bd8c",
          logo: "/icon.svg",
          walletChainType: "ethereum-and-solana",
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "all-users",
          },
          solana: {
            createOnLogin: "all-users",
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
