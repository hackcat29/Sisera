import { ArrowLeft, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SiseraMark } from "../../components/operator-shell";
import { SiseraPrivyProvider } from "../../components/privy-provider";
import { PrivySignIn } from "../../components/privy-sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: true },
};

export default function SignInPage() {
  return (
    <main className="grid min-h-screen bg-ink-deep lg:grid-cols-[1.05fr_.95fr]">
      <section className="technical-grid relative hidden overflow-hidden border-r border-line p-10 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="relative z-10 flex items-center gap-3">
          <SiseraMark />
          <span className="text-sm font-semibold tracking-[.2em]">SISERA</span>
        </Link>
        <div className="relative z-10 max-w-2xl">
          <p className="eyebrow">Solana Financial Terminal</p>
          <h1 className="display mt-6 text-6xl leading-[1.02] text-bone">
            Stocks, perps, predictions and
            <br />
            <em className="text-bronze-300">rule-bound agents.</em>
          </h1>
          <p className="mt-6 max-w-lg text-sm leading-7 text-slate-300">
            One terminal for tokenized stocks and private markets, Hyperliquid perps and spot, and
            prediction markets, all from your own wallet, with research agents that respect your
            risk limits.
          </p>
        </div>
        <p className="relative z-10 font-mono text-[10px] uppercase tracking-[.16em] text-slate-500">
          sisera.xyz · Research terminal
        </p>
      </section>
      <section className="flex min-h-screen flex-col bg-ink-deep">
        <div className="flex h-16 items-center justify-between border-b border-line px-6 lg:px-10">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-white"
          >
            <ArrowLeft size={14} /> Back to site
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-lg">
            <div className="grid size-11 place-items-center border border-bronze-400/30 bg-bronze-400/10 text-bronze-300">
              <KeyRound size={19} />
            </div>

            <h2 className="display mt-4 text-4xl text-bone">Sign in to Sisera</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">
              Access your portfolio, research agents, and live market intelligence.
            </p>
            <Suspense
              fallback={
                <div className="mt-8 h-48 animate-pulse rounded border border-line bg-panel/40" />
              }
            >
              <SiseraPrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}>
                <PrivySignIn />
              </SiseraPrivyProvider>
            </Suspense>
          </div>
        </div>
      </section>
    </main>
  );
}
