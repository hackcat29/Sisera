"use client";

import { usePrivy } from "@privy-io/react-auth";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDownToLine, Check, Copy, X } from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { getPrivySolanaAddress } from "../lib/privy-identity";
import { useSiseraWallets } from "../lib/use-sisera-wallets";

function AddressCard({
  title,
  address,
  networks,
  accepts,
}: {
  title: string;
  address: string | null;
  networks: string;
  accepts: string;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!address) return;
    void QRCode.toDataURL(address, {
      margin: 1,
      width: 176,
      color: { dark: "#0C141B", light: "#F2F0E9" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [address]);

  return (
    <div className="flex gap-4 rounded border border-line bg-ink-raised/60 p-4">
      <div className="grid size-[104px] shrink-0 place-items-center rounded bg-[#F2F0E9]">
        {qr ? (
          <img src={qr} alt={`${title} deposit address QR code`} width={96} height={96} />
        ) : (
          <span className="text-[10px] text-slate-500">…</span>
        )}
      </div>
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-semibold text-slate-100">{title}</p>
        <p className="mt-1 text-[11px] leading-4 text-slate-400">{networks}</p>
        <p className="mt-2 break-all font-mono text-[11px] text-slate-200">
          {address ?? "Setting up your wallet…"}
        </p>
        <button
          type="button"
          disabled={!address}
          onClick={() => {
            if (!address) return;
            void navigator.clipboard.writeText(address).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="mt-2 inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 text-[11px] text-slate-200 hover:border-bronze-400/50 disabled:opacity-40"
        >
          {copied ? <Check size={12} className="text-emerald-300" /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy address"}
        </button>
        <p className="mt-2 text-[10px] leading-4 text-slate-500">{accepts}</p>
      </div>
    </div>
  );
}

/**
 * Where to send funds, for every way a user might arrive: Solana tokens, tokens on EVM chains, or
 * USDC already on Hyperliquid. Both wallets belong to the user's Sisera account.
 */
export function FundAccountButton({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const { authenticated, user } = usePrivy();
  const { evmAddress, solanaAddress } = useSiseraWallets();
  const solana = solanaAddress ?? getPrivySolanaAddress(user);
  if (!authenticated) return null;

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={`inline-flex h-9 items-center gap-2 rounded-md bg-bronze-300 px-3 text-[12px] font-semibold text-[#0b1b24] hover:bg-bronze-200 ${className}`}
        >
          <ArrowDownToLine size={14} />
          {compact ? "Deposit" : "Deposit funds"}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-line bg-panel p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-slate-100">
              Deposit funds
            </Dialog.Title>
            <Dialog.Close className="text-slate-400 hover:text-slate-100" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-xs leading-5 text-slate-400">
            Send crypto to your own Sisera wallets. Only you control them. Pick the address for the
            network you're sending from.
          </Dialog.Description>
          <div className="mt-4 space-y-3">
            <AddressCard
              title="Solana"
              address={solana}
              networks="For anything on the Solana network."
              accepts="USDC is ready to trade stocks, private markets and predictions. SOL and other Solana tokens can be swapped to USDC in one step. Keep about 0.01 SOL for network fees."
            />
            <AddressCard
              title="Ethereum and EVM chains"
              address={evmAddress}
              networks="Ethereum, Base, Arbitrum, Optimism, Polygon and BNB Chain. Also your Hyperliquid account."
              accepts="Any token on these chains can be swapped to USDC. USDC sent to this address on Hyperliquid (from Hyperliquid or an exchange that supports it) is ready for perps."
            />
          </div>
          <div className="mt-4 rounded border border-line p-3 text-xs leading-5 text-slate-300">
            <p className="font-semibold text-slate-100">After your deposit arrives</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-slate-400">
              <li>
                Not USDC?{" "}
                <Dialog.Close asChild>
                  <Link href="/portfolio#swap" className="text-bronze-300 hover:text-bronze-200">
                    Swap it to USDC
                  </Link>
                </Dialog.Close>
                .
              </li>
              <li>
                Trade{" "}
                <Dialog.Close asChild>
                  <Link href="/stocks" className="text-bronze-300 hover:text-bronze-200">
                    stocks
                  </Link>
                </Dialog.Close>
                ,{" "}
                <Dialog.Close asChild>
                  <Link href="/predictions" className="text-bronze-300 hover:text-bronze-200">
                    predictions
                  </Link>
                </Dialog.Close>{" "}
                or{" "}
                <Dialog.Close asChild>
                  <Link
                    href="/terminal?venue=hyperliquid"
                    className="text-bronze-300 hover:text-bronze-200"
                  >
                    perps
                  </Link>
                </Dialog.Close>
                . Perps move USDC into Hyperliquid in about a second.
              </li>
            </ol>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-slate-500">
            Double-check the network before sending. Funds sent on an unsupported network may not be
            recoverable.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
