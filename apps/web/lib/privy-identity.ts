import type { User } from "@privy-io/react-auth";

export function getPrivyDisplayName(user: User | null | undefined): string {
  if (!user) return "Operator";
  return (
    user.google?.name?.trim() ||
    user.twitter?.name?.trim() ||
    user.twitter?.username?.trim() ||
    user.discord?.username?.trim() ||
    user.email?.address?.trim() ||
    user.google?.email?.trim() ||
    user.discord?.email?.trim() ||
    "Operator"
  );
}

/**
 * The account's Solana wallet: one the user signed in with (Phantom, Solflare…) if any, otherwise
 * the embedded wallet Sisera created. Every screen uses this rule so they show the same wallet.
 */
export function getPrivySolanaAddress(user: User | null | undefined): string | null {
  const wallets = (user?.linkedAccounts ?? []).filter(
    (account): account is Extract<typeof account, { type: "wallet" }> =>
      account.type === "wallet" && account.chainType === "solana",
  );
  const external = wallets.find((wallet) => wallet.walletClientType !== "privy");
  return (external ?? wallets[0])?.address ?? null;
}
