"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";

export type RelayTransaction = {
  from: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
};
export type RelayStep = { id?: string | null; kind: string; items: RelayTransaction[] };

const APPROVAL_STEPS = new Set(["approve", "approval"]);

/**
 * Sends a Relay quote's transactions from the user's wallet, in order, waiting for each to confirm
 * before the next (an ERC-20 approval must land before the swap that spends it). The first
 * non-approval transaction is recorded as the transfer's source so Sisera can track delivery.
 */
export async function executeRelaySteps(input: {
  wallet: ConnectedWallet;
  originChainId: number;
  requestId: string | null;
  steps: readonly RelayStep[];
  onProgress: (message: string) => void;
  /** Called once a transaction has been sent, before it confirms. */
  onSubmitted?: (hash: string) => void;
}) {
  const { wallet, originChainId } = input;
  await wallet.switchChain(originChainId);
  const provider = await wallet.getEthereumProvider();
  let sourceTxHash: string | null = null;
  let trackingDelayed = false;
  for (const step of input.steps) {
    if (step.kind !== "transaction")
      throw new Error("Unsupported wallet step. Request a new quote.");
    const approval = APPROVAL_STEPS.has(step.id ?? "");
    for (const transaction of step.items) {
      if (
        transaction.chainId !== originChainId ||
        transaction.from.toLowerCase() !== wallet.address.toLowerCase()
      )
        throw new Error("Quote wallet or chain does not match your connected wallet.");
      input.onProgress(
        approval ? "Approve the token in your wallet…" : "Confirm the transfer in your wallet…",
      );
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: transaction.from,
            to: transaction.to,
            data: transaction.data,
            value: `0x${BigInt(transaction.value).toString(16)}`,
          },
        ],
      })) as string;
      input.onSubmitted?.(hash);
      if (!approval && !sourceTxHash) {
        sourceTxHash = hash;
        if (input.requestId) {
          try {
            const recorded = await fetch("/api/bridge/submission", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ requestId: input.requestId, sourceTxHash: hash }),
            });
            if (!recorded.ok) trackingDelayed = true;
          } catch {
            trackingDelayed = true;
          }
        }
      }
      input.onProgress(
        `${approval ? "Approval" : "Transaction"} submitted: ${hash.slice(0, 12)}… Waiting for confirmation.`,
      );
      let confirmed = false;
      for (let attempt = 0; attempt < 45; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const receipt = (await provider.request({
          method: "eth_getTransactionReceipt",
          params: [hash],
        })) as { status?: string } | null;
        if (!receipt) continue;
        if (receipt.status !== "0x1")
          throw new Error(
            approval ? "The token approval failed." : "The source chain transaction failed.",
          );
        confirmed = true;
        break;
      }
      if (!confirmed)
        throw new Error(
          `Transaction ${hash} is pending. Check Activity or your wallet before trying again.`,
        );
    }
  }
  return { sourceTxHash, trackingDelayed };
}

/** Relay statuses after which a transfer will not change. */
export const FINAL_RELAY_STATUSES = new Set(["success", "failure", "refund", "refunded"]);

/** Polls a transfer's Relay status until it settles or about three minutes pass. */
export async function waitForRelay(
  requestId: string,
  onStatus: (status: { status: string; txHashes?: string[] }) => void,
) {
  for (let attempt = 0; attempt < 45; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const response = await fetch(`/api/bridge?requestId=${encodeURIComponent(requestId)}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => null);
    const status = payload?.data;
    if (typeof status?.status !== "string") continue;
    onStatus(status);
    if (FINAL_RELAY_STATUSES.has(status.status.toLowerCase())) return status;
  }
  return null;
}
