"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSolanaStandardWallets } from "@privy-io/react-auth/solana";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, ExternalLink, KeyRound, LogOut, Wallet, WalletCards, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getPrivySolanaAddress } from "../lib/privy-identity";

interface SolanaProvider {
  isPhantom?: boolean;
  isBackpack?: boolean;
  publicKey?: { toString(): string };
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{
    publicKey: { toString(): string };
  }>;
  disconnect: () => Promise<void>;
}

function getBrowserSolanaProvider(): SolanaProvider | null {
  if (typeof window === "undefined") return null;
  const anyWin = window as unknown as {
    phantom?: { solana?: SolanaProvider };
    solana?: SolanaProvider;
    backpack?: SolanaProvider;
    solflare?: SolanaProvider;
  };
  return anyWin.phantom?.solana || anyWin.solana || anyWin.backpack || anyWin.solflare || null;
}

const STORAGE_KEY = "sisera_active_wallet";
const SAMPLE_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

export function PortfolioConnect({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { ready, authenticated, user } = usePrivy();
  const { wallets: standardWallets } = useSolanaStandardWallets();
  const [manualAddress, setManualAddress] = useState<string | null>(null);
  const privyAddress = authenticated ? getPrivySolanaAddress(user) : null;
  const standardAddress = standardWallets.find((wallet) => wallet.accounts.length > 0)?.accounts[0]
    ?.address;
  const address = privyAddress || standardAddress || manualAddress;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inputAddress, setInputAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Stored manual addresses belong only to guest or direct-wallet sessions.
  useEffect(() => {
    if (!ready) return;
    if (authenticated && privyAddress) {
      setManualAddress(null);
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(saved)) {
      setManualAddress(saved);
    } else {
      // Check if browser wallet is already connected
      const provider = getBrowserSolanaProvider();
      if (provider?.publicKey) {
        const pub = provider.publicKey.toString();
        setManualAddress(pub);
        localStorage.setItem(STORAGE_KEY, pub);
      }
    }

    const handleWalletChanged = (event: Event) => {
      const custom = event as CustomEvent<string | null>;
      setManualAddress(custom.detail);
    };
    window.addEventListener("sisera_wallet_changed", handleWalletChanged);
    return () => window.removeEventListener("sisera_wallet_changed", handleWalletChanged);
  }, [ready, authenticated, privyAddress]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  function setWallet(newAddress: string | null) {
    if (newAddress) {
      localStorage.setItem(STORAGE_KEY, newAddress);
      setManualAddress(newAddress);
      window.dispatchEvent(new CustomEvent("sisera_wallet_changed", { detail: newAddress }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setManualAddress(null);
      window.dispatchEvent(new CustomEvent("sisera_wallet_changed", { detail: null }));
    }
  }

  async function connectBrowserWallet() {
    setError(null);
    setConnecting(true);
    try {
      const provider = getBrowserSolanaProvider();
      if (!provider) {
        throw new Error(
          "No Solana extension detected. Please install Phantom, Backpack, or Solflare, or enter an address below.",
        );
      }
      const response = await provider.connect();
      const pubkey = response.publicKey.toString();
      setWallet(pubkey);
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect browser wallet");
    } finally {
      setConnecting(false);
    }
  }

  function connectManualAddress(customAddress?: string) {
    setError(null);
    const target = (customAddress || inputAddress).trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(target)) {
      setError("Please enter a valid base58 Solana public address (32-44 characters)");
      return;
    }
    setWallet(target);
    setInputAddress("");
    setModalOpen(false);
  }

  function handleCopy() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDisconnect() {
    const provider = getBrowserSolanaProvider();
    if (provider) {
      provider.disconnect?.().catch(() => {});
    }
    setWallet(null);
    setDropdownOpen(false);
  }

  const shortAddress = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null;

  return (
    <div className="relative" ref={dropdownRef}>
      {authenticated && !privyAddress ? (
        // Signed-in users trade from wallets linked to their account, which Privy is creating.
        <span className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-[12px] text-slate-400">
          <WalletCards size={14} />
          {compact ? "Setting up…" : "Setting up wallet…"}
        </span>
      ) : address ? (
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex h-9 items-center gap-2 rounded border border-bronze-400/40 bg-bronze-400/10 px-3 text-xs font-mono font-medium text-bronze-200 hover:bg-bronze-400/20 transition-colors"
          aria-expanded={dropdownOpen}
          aria-label="Connected Solana wallet"
        >
          <span className="size-2 rounded-full bg-emerald-400" />
          <WalletCards size={14} className="text-bronze-300" />
          <span>{shortAddress}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setModalOpen(true);
          }}
          className="flex h-9 items-center gap-2 rounded border border-bronze-400/30 bg-bronze-400/10 px-3 text-xs font-medium text-bronze-200 hover:bg-bronze-400/20 transition-colors"
        >
          <WalletCards size={14} />
          <span>{compact ? "Connect" : "Connect wallet"}</span>
        </button>
      )}

      {/* Connected Wallet Dropdown */}
      {dropdownOpen && address && (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-lg border border-line bg-panel p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                Connected Solana Wallet
              </p>
              <p className="mt-1 font-mono text-xs font-medium text-white">{shortAddress}</p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 rounded border border-line bg-ink-raised px-2 py-1 text-[11px] text-slate-300 hover:text-white"
              title="Copy full address"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          <div className="mt-3 space-y-1 text-xs">
            <Link
              href={`/portfolio?solana=${encodeURIComponent(address)}`}
              onClick={() => setDropdownOpen(false)}
              className="flex items-center justify-between rounded px-2.5 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <span>View in Portfolio</span>
              <ExternalLink size={13} className="text-slate-400" />
            </Link>

            <a
              href={`https://explorer.solana.com/address/${encodeURIComponent(address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded px-2.5 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <span>Solana Explorer</span>
              <ExternalLink size={13} className="text-slate-400" />
            </a>
          </div>

          {!privyAddress && (
            <div className="mt-3 border-t border-line pt-2">
              <button
                type="button"
                onClick={handleDisconnect}
                className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 transition-colors"
              >
                <span>Disconnect Wallet</span>
                <LogOut size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Connect Modal Dialog */}
      <Dialog.Root open={modalOpen} onOpenChange={setModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-panel p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center gap-2">
                <Wallet className="text-bronze-300" size={18} />
                <Dialog.Title className="text-base font-semibold text-white">
                  Connect Solana Wallet
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 hover:text-white"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-5 space-y-4">
              {/* Option 1: Browser Wallet */}
              <div>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={connectBrowserWallet}
                  className="flex w-full items-center justify-between rounded-lg border border-bronze-400/40 bg-ink-raised p-3.5 text-left transition-colors hover:border-bronze-300 hover:bg-[#14232f]"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-9 place-items-center rounded bg-bronze-300/10 text-bronze-300">
                      <WalletCards size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">Browser Wallet</p>
                      <p className="text-[11px] text-slate-400">Phantom, Backpack, or Solflare</p>
                    </div>
                  </div>
                  <span className="rounded bg-bronze-300/20 px-2 py-1 font-mono text-[10px] text-bronze-300">
                    {connecting ? "Connecting…" : "Connect"}
                  </span>
                </button>
              </div>

              {/* Option 2: Enter Solana Address */}
              <div className="rounded-lg border border-line bg-[#0d141b] p-4">
                <div className="flex items-center gap-2">
                  <KeyRound size={14} className="text-slate-400" />
                  <p className="text-xs font-semibold text-slate-200">Enter Public Address</p>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Inspect your Solana holdings, balances, and risk in the terminal.
                </p>

                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={inputAddress}
                    onChange={(e) => setInputAddress(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") connectManualAddress();
                    }}
                    placeholder="Solana address (base58)"
                    className="flex-1 rounded border border-line bg-panel px-3 py-1.5 font-mono text-xs text-white placeholder-slate-600 outline-none focus:border-bronze-400"
                  />
                  <button
                    type="button"
                    onClick={() => connectManualAddress()}
                    className="rounded bg-bronze-300 px-3 py-1.5 text-xs font-semibold text-panel hover:bg-bronze-200 transition-colors"
                  >
                    View
                  </button>
                </div>

                <div className="mt-2.5 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Need a sample wallet?</span>
                  <button
                    type="button"
                    onClick={() => connectManualAddress(SAMPLE_WALLET)}
                    className="font-mono text-bronze-300 hover:underline"
                  >
                    Use sample address
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                  {error}
                </div>
              )}
            </div>

            <div className="mt-6 border-t border-line pt-3 text-center">
              <p className="font-mono text-[10px] text-slate-500">
                Non-custodial terminal · Private keys are never requested or stored
              </p>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
