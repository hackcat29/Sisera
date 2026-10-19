import { ArrowRight, Wallet } from "lucide-react";
import Link from "next/link";

/** Stands in for an order ticket on public market pages until the visitor signs in. */
export function SignInToTrade({ label, returnTo }: { label: string; returnTo: string }) {
  return (
    <section className="border border-line bg-panel p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center border border-line text-bronze-300">
          <Wallet size={16} />
        </span>
        <div>
          <p className="text-sm font-semibold text-bone">Trade {label}</p>
          <p className="text-[12px] text-slate-400">Free to use.</p>
        </div>
      </div>
      <ul className="mt-4 space-y-1.5 text-[12px] leading-5 text-slate-300">
        <li>Sign in with email, Google or a wallet. Your wallet is ready in seconds.</li>
        <li>Fund it with any token; Sisera converts it to USDC for trading.</li>
        <li>You keep custody. Every order is risk-checked before it is placed.</li>
      </ul>
      <Link
        href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
        className="mt-5 flex items-center justify-center gap-2 bg-bronze-300 px-4 py-3 text-sm font-semibold text-ink hover:bg-bronze-200"
      >
        Sign in to trade <ArrowRight size={15} />
      </Link>
    </section>
  );
}
