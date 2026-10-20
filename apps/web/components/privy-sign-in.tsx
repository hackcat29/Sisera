"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Globe2,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  UserCheck,
  Wallet,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getPrivySolanaAddress } from "../lib/privy-identity";

const STORAGE_KEY = "sisera_active_wallet";
const SAMPLE_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

export function PrivySignIn() {
  const { ready, authenticated, user, login, getAccessToken } = usePrivy();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPath = searchParams.get("returnTo") || searchParams.get("next") || "/stocks";
  const returnTo =
    requestedPath.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/stocks";

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync session whenever Privy is authenticated
  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;

    async function syncPrivySession() {
      try {
        setLoadingAction("Syncing session...");
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("Could not retrieve authentication token.");

        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });

        if (!response.ok) {
          throw new Error("Unable to establish institutional session. Please try again.");
        }

        // The workspace reads the Privy wallet directly, including wallets created after login.
        if (getPrivySolanaAddress(user)) localStorage.removeItem(STORAGE_KEY);

        if (!cancelled) {
          router.replace(returnTo);
          router.refresh();
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Authentication failed";
          setError(msg);
          setLoadingAction(null);
        }
      }
    }

    void syncPrivySession();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, user, getAccessToken, router, returnTo]);

  // Handle standard Privy modal
  const handlePrivyLogin = useCallback(
    (method?: "email" | "google" | "twitter" | "discord" | "wallet") => {
      setError(null);
      if (!ready) {
        setLoadingAction("Initializing...");
        const checkInterval = setInterval(() => {
          if (ready) {
            clearInterval(checkInterval);
            setLoadingAction(null);
            if (method) {
              login({ loginMethods: [method] });
            } else {
              login();
            }
          }
        }, 150);
        setTimeout(() => clearInterval(checkInterval), 4000);
        return;
      }

      try {
        if (method) {
          login({ loginMethods: [method] });
        } else {
          login();
        }
      } catch (err) {
        setError("Could not launch authentication window. Please try again.");
      }
    },
    [ready, login],
  );

  // Handle Guest / Demo Workspace
  const handleGuestLogin = useCallback(async () => {
    setError(null);
    setLoadingAction("Entering workspace as guest...");
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, SAMPLE_WALLET);
        window.dispatchEvent(new CustomEvent("sisera_wallet_changed", { detail: SAMPLE_WALLET }));
      }

      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "guest" }),
      });

      if (!response.ok) {
        throw new Error("Could not initialize guest session.");
      }

      router.replace(returnTo);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Guest access failed.";
      setError(msg);
      setLoadingAction(null);
    }
  }, [router, returnTo]);

  const isBusy = Boolean(loadingAction);

  return (
    <div className="mt-8 space-y-6">
      {/* Active Loading / Error State */}
      {error && (
        <div
          role="alert"
          className="rounded border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300"
        >
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-[11px] underline hover:text-white"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loadingAction && (
        <div className="flex items-center gap-2.5 rounded border border-bronze-500/30 bg-bronze-500/10 p-3 text-xs text-bronze-200">
          <Loader2 size={14} className="animate-spin text-bronze-400" />
          <span>{loadingAction}</span>
        </div>
      )}

      {/* 1. Primary Unified Continue Button */}
      {/* <div>
        <button
          type="button"
          onClick={() => handlePrivyLogin()}
          disabled={isBusy}
          className="group relative flex h-12 w-full items-center justify-between rounded border border-bronze-300/60 bg-gradient-to-r from-bronze-400 to-bronze-300 px-5 text-sm font-semibold text-[#09141c] shadow-[0_0_24px_rgba(103,232,249,0.22)] transition-all hover:border-bronze-200 hover:from-bronze-300 hover:to-bronze-200 hover:shadow-[0_0_30px_rgba(103,232,249,0.35)] disabled:opacity-50"
        >
          <span className="flex items-center gap-2.5">
            <KeyRound size={16} />
            <span>Continue with Privy</span>
          </span>
          <ArrowRight
            size={16}
            className="transition-transform duration-200 group-hover:translate-x-1"
          />
        </button>
       
      </div> */}

      {/* 2. Direct Social Buttons (Google, X, Discord, Email) */}
      <div className="space-y-2.5">
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-line/60" />
          </div>
          <span className="relative bg-ink-deep px-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Sign in with
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {/* Google */}
          <button
            type="button"
            onClick={() => handlePrivyLogin("google")}
            disabled={isBusy}
            title="Sign in with Google"
            className="flex h-11 items-center justify-center gap-1.5 rounded border border-line bg-ink-deep p-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-ink-raised hover:text-white disabled:opacity-50"
          >
            <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
              />
            </svg>
            <span className="hidden sm:inline">Google</span>
          </button>

          {/* X / Twitter */}
          <button
            type="button"
            onClick={() => handlePrivyLogin("twitter")}
            disabled={isBusy}
            title="Sign in with X (Twitter)"
            className="flex h-11 items-center justify-center gap-1.5 rounded border border-line bg-ink-deep p-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-ink-raised hover:text-white disabled:opacity-50"
          >
            <svg aria-hidden="true" className="size-3.5 shrink-0 fill-white" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span className="hidden sm:inline">X</span>
          </button>

          {/* Discord */}
          <button
            type="button"
            onClick={() => handlePrivyLogin("discord")}
            disabled={isBusy}
            title="Sign in with Discord"
            className="flex h-11 items-center justify-center gap-1.5 rounded border border-line bg-ink-deep p-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-ink-raised hover:text-white disabled:opacity-50"
          >
            <svg aria-hidden="true" className="size-4 shrink-0 fill-[#5865F2]" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            <span className="hidden sm:inline">Discord</span>
          </button>

          {/* Email */}
          <button
            type="button"
            onClick={() => handlePrivyLogin("email")}
            disabled={isBusy}
            title="Sign in with Email"
            className="flex h-11 items-center justify-center gap-1.5 rounded border border-line bg-ink-deep p-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-ink-raised hover:text-white disabled:opacity-50"
          >
            <Mail size={15} className="text-bronze-400" />
            <span className="hidden sm:inline">Email</span>
          </button>
        </div>
      </div>

      {/* 3. Direct Solana Wallet Connection */}
      <div className="space-y-2">
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-line/60" />
          </div>
          <span className="relative bg-ink-deep px-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            or connect web3 wallet
          </span>
        </div>

        <button
          type="button"
          onClick={() => handlePrivyLogin("wallet")}
          disabled={isBusy}
          className="group flex w-full items-center justify-between rounded border border-line bg-[#0c141d] p-3 text-left transition-all hover:border-purple-400/40 hover:bg-[#111a26] disabled:opacity-50"
        >
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
              <svg aria-hidden="true" className="size-4" viewBox="0 0 397 311" fill="none">
                <path
                  d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"
                  fill="url(#sol-grad-1)"
                />
                <path
                  d="M64.6 3.8C67 1.4 70.3 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"
                  fill="url(#sol-grad-2)"
                />
                <path
                  d="M333.4 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.8c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"
                  fill="url(#sol-grad-3)"
                />
                <defs>
                  <linearGradient
                    id="sol-grad-1"
                    x1="391.2"
                    y1="234.1"
                    x2="6.5"
                    y2="311.7"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop stopColor="#00FFA3" />
                    <stop offset="1" stopColor="#DC1FFF" />
                  </linearGradient>
                  <linearGradient
                    id="sol-grad-2"
                    x1="391.2"
                    y1="0"
                    x2="6.5"
                    y2="77.6"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop stopColor="#00FFA3" />
                    <stop offset="1" stopColor="#DC1FFF" />
                  </linearGradient>
                  <linearGradient
                    id="sol-grad-3"
                    x1="6.8"
                    y1="116.3"
                    x2="391.5"
                    y2="193.9"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop stopColor="#00FFA3" />
                    <stop offset="1" stopColor="#DC1FFF" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-white group-hover:text-purple-200">
                Connect a wallet
              </p>
              <p className="text-[11px] text-slate-400">
                Phantom, Solflare, Backpack, MetaMask, Rabby and more
              </p>
            </div>
          </div>
          <ChevronRight
            size={16}
            className="text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white"
          />
        </button>
      </div>

      {/* 4. Instant Guest / Demo Mode */}
      {process.env.NODE_ENV !== "production" && (
        <div className="space-y-2">
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-line/60" />
            </div>
            <span className="relative bg-ink-deep px-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              instant preview
            </span>
          </div>

          <button
            type="button"
            onClick={handleGuestLogin}
            disabled={isBusy}
            className="group flex w-full items-center justify-between rounded border border-emerald-500/25 bg-emerald-500/[0.05] p-3 text-left transition-all hover:border-emerald-400/50 hover:bg-emerald-500/[0.09] disabled:opacity-50"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded bg-emerald-400/10 text-emerald-300 border border-emerald-400/20">
                <UserCheck size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-white group-hover:text-emerald-200">
                    Enter Workspace as Guest
                  </p>
                  <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300 uppercase">
                    1-Click
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Instant demo access to markets, Pyth oracle feeds, and agents
                </p>
              </div>
            </div>
            <ChevronRight
              size={16}
              className="text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white"
            />
          </button>
        </div>
      )}

      {/* Institutional Invariant Notice */}
      <div className="rounded border border-line/50 bg-[#080d14] p-3 text-[11px] text-slate-500">
        <div className="flex items-start gap-2">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-bronze-400" />
          <span className="leading-relaxed">
            You get your own Solana and EVM wallets in seconds. Only you control your funds, and
            every order is checked against your risk limits before it is placed.
          </span>
        </div>
      </div>
    </div>
  );
}
