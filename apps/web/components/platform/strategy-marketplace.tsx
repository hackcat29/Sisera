"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { platform } from "../../lib/platform";
import { useSolanaSigner } from "../../lib/use-solana-signer";
import { Panel, Stat } from "./ui";

type Listing = {
  id: string;
  title: string;
  description: string;
  creatorName: string;
  category: string;
  priceUsdc: number;
  version: string;
  status: string;
  isCreator: boolean;
  licensed: boolean;
  sales?: number;
  earnedUsdc?: number;
  universe: string[];
  evaluation: string;
};
type Pending = { id: string; signed?: string; listingId: string };
const categories = ["trend", "mean_reversion", "arbitrage", "event", "other"];
const inputClass = "w-full border border-line bg-ink px-3 py-2 text-xs text-white";
const buttonClass =
  "border border-bronze-400/40 px-3 py-2 text-xs text-bronze-200 hover:bg-bronze-300/10 disabled:opacity-40";
export function StrategyMarketplace({
  agents,
}: { agents: Array<{ id: string; name: string; version: string }> }) {
  const signer = useSolanaSigner();
  const router = useRouter();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("discover");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const reload = async () => {
    const data = await platform<Listing[]>("marketplace");
    setListings(data);
  };
  useEffect(() => {
    let active = true;
    platform<Listing[]>("marketplace")
      .then((data) => {
        if (active) setListings(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // Retain signed payment bytes across a refresh so confirmation retries never charge twice.
    const saved = sessionStorage.getItem("sisera-strategy-checkout");
    if (saved) {
      try {
        setPending(JSON.parse(saved));
      } catch {
        sessionStorage.removeItem("sisera-strategy-checkout");
      }
    }
    platform<Array<{ id: string; listingId: string }>>("marketplace/checkouts")
      .then((checkouts) => {
        if (!active || !checkouts[0]) return;
        const checkout = checkouts[0];
        setPending((current) => (current?.id === checkout.id ? current : checkout));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };
  async function confirmPayment(payment: Pending) {
    const result = await platform<{ licensed: boolean; pending: boolean; failed?: boolean }>(
      `marketplace/checkouts/${payment.id}/settle`,
      { body: { signedTransaction: payment.signed } },
    );
    if (result.licensed) {
      setPending(null);
      sessionStorage.removeItem("sisera-strategy-checkout");
      setMessage("Payment confirmed. Your strategy license is ready.");
      await reload();
    } else if (result.failed) {
      setPending(null);
      sessionStorage.removeItem("sisera-strategy-checkout");
      throw new Error(
        "The payment failed or expired. No license was issued; you can start a new checkout.",
      );
    } else setMessage("Payment submitted. Check confirmation shortly to unlock your license.");
  }
  async function buy(l: Listing) {
    if (pending)
      throw new Error("Finish confirming your pending payment before starting another purchase.");
    if (!signer.address && l.priceUsdc > 0) throw new Error("Connect a Solana wallet to continue.");
    const quote = await platform<{
      id: string | null;
      transaction: string | null;
      licensed: boolean;
      priceUsdc: number;
      recipient: string;
    }>(`marketplace/${l.id}/checkout`, { body: { wallet: signer.address ?? undefined } });
    if (quote.licensed) {
      setMessage("Free license added to your library.");
      await reload();
      return;
    }
    if (!quote.id || !quote.transaction) throw new Error("Checkout was not prepared.");
    const [signed] = await signer.signAll([quote.transaction]);
    if (!signed) throw new Error("Payment was not signed.");
    const next = { id: quote.id, signed, listingId: l.id };
    setPending(next);
    sessionStorage.setItem("sisera-strategy-checkout", JSON.stringify(next));
    await confirmPayment(next);
  }
  const visible = useMemo(
    () =>
      listings
        .filter((l) =>
          tab === "creator"
            ? l.isCreator
            : tab === "library"
              ? l.licensed || l.isCreator
              : l.status === "published",
        )
        .filter((l) => category === "all" || l.category === category)
        .filter((l) =>
          `${l.title} ${l.description} ${l.creatorName} ${l.universe.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
    [listings, tab, category, search],
  );
  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Published strategies"
          value={listings.filter((l) => l.status === "published").length}
        />
        <Stat label="Your library" value={listings.filter((l) => l.licensed).length} />
        <Stat
          label="Your creator earnings"
          value={`${listings
            .filter((l) => l.isCreator)
            .reduce((sum, l) => sum + (l.earnedUsdc ?? 0), 0)
            .toFixed(2)} USDC`}
          hint="Paid directly to your wallet"
        />
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Marketplace views">
        {[
          ["discover", "Discover"],
          ["library", "My library"],
          ["creator", "Creator studio"],
        ].map(([value, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === value}
            key={value}
            onClick={() => setTab(value ?? "discover")}
            className={`${buttonClass} ${tab === value ? "bg-bronze-300/10" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="border border-rose-400/30 p-3 text-xs text-rose-200">
          {error}
        </p>
      )}
      {message && (
        <output className="block border border-bronze-400/30 p-3 text-xs text-bronze-200">
          {message}
        </output>
      )}
      {pending && (
        <Panel title="Payment awaiting confirmation">
          <div className="space-y-3 p-4 text-xs text-slate-400">
            <p>
              Your signed checkout is saved in this browser. Checking it again submits the same
              payment.
            </p>
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => void run(() => confirmPayment(pending))}
            >
              Check payment confirmation
            </button>
          </div>
        </Panel>
      )}
      {tab === "creator" && (
        <Panel title="Publish a strategy">
          <form
            className="grid gap-3 p-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void run(async () => {
                if (!signer.address) throw new Error("Connect your payout wallet first.");
                await platform("marketplace", {
                  body: {
                    agentId: form.get("agentId"),
                    title: form.get("title"),
                    description: form.get("description"),
                    creatorName: form.get("creatorName"),
                    category: form.get("category"),
                    priceUsdc: Number(form.get("priceUsdc")),
                    payoutWallet: signer.address,
                  },
                });
                setMessage("Strategy published. Buyers can now license this version.");
                await reload();
              });
            }}
          >
            <label className="text-xs text-slate-400">
              Strategy version
              <select required name="agentId" className={`${inputClass} mt-1`} defaultValue="">
                <option value="" disabled>
                  Choose a strategy with executable rules
                </option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · v{a.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Listing title
              <input
                required
                name="title"
                minLength={3}
                maxLength={80}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="text-xs text-slate-400">
              Creator display name
              <input
                required
                name="creatorName"
                minLength={2}
                maxLength={50}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="text-xs text-slate-400">
              Category
              <select name="category" className={`${inputClass} mt-1`}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400 sm:col-span-2">
              What does this strategy do?
              <textarea
                required
                name="description"
                minLength={20}
                maxLength={1000}
                rows={3}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="text-xs text-slate-400">
              One-time license price (USDC)
              <input
                required
                name="priceUsdc"
                type="number"
                min={0}
                max={10000}
                step="0.01"
                defaultValue={0}
                className={`${inputClass} mt-1`}
              />
            </label>
            <p className="self-end break-all text-xs text-slate-400">
              Payout wallet: {signer.address ?? "Connect a Solana wallet"}. You receive the full
              license price; the buyer pays network fees.
            </p>
            <p className="text-xs leading-5 text-slate-400 sm:col-span-2">
              Listings share a fixed version of your strategy rules. Buyers may inspect and
              customize those rules after purchase. Your wallet settings and promotion approvals
              stay with you.
            </p>
            <button type="submit" disabled={busy || !agents.length} className={buttonClass}>
              Publish strategy
            </button>
            <Link href="/agents" className="self-center text-xs text-bronze-200">
              Create a strategy →
            </Link>
          </form>
        </Panel>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          aria-label="Search strategies"
          placeholder="Search strategies, creators or markets"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
        />
        <select
          aria-label="Filter strategy category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={inputClass}
        >
          <option value="all">All strategies</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p className="p-6 text-xs text-slate-400">Loading strategies…</p>
      ) : !visible.length ? (
        <Panel>
          <div className="p-8 text-sm text-slate-400">
            {tab === "library"
              ? "Your licensed strategies will appear here."
              : tab === "creator"
                ? "Publish your first strategy above."
                : "No strategies match yet. Be the first to publish a strategy."}
          </div>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((l) => (
            <article key={l.id} className="flex flex-col border border-line bg-panel p-5">
              <div className="flex justify-between text-[10px] uppercase text-slate-500">
                <span>{l.category.replace("_", " ")}</span>
                <span>
                  v{l.version} · {l.status}
                </span>
              </div>
              <h2 className="mt-3 text-base font-semibold text-white">{l.title}</h2>
              <p className="mt-1 text-xs text-bronze-200">by {l.creatorName}</p>
              <p className="mt-3 flex-1 text-xs leading-5 text-slate-400">{l.description}</p>
              <p className="mt-4 truncate font-mono text-[10px] text-slate-500">
                {l.universe.join(" · ")}
              </p>
              <p className="mt-3 text-[11px] leading-5 text-amber-200/80">{l.evaluation}</p>
              {l.isCreator && (
                <p className="mt-3 text-xs text-slate-300">
                  {l.sales ?? 0} licenses · {(l.earnedUsdc ?? 0).toFixed(2)} USDC earned
                </p>
              )}
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-4">
                <span className="font-mono text-sm text-white">
                  {l.priceUsdc ? `${l.priceUsdc.toFixed(2)} USDC` : "Free"}
                  <span className="block text-[10px] text-slate-500">
                    One-time strategy license
                  </span>
                </span>
                {l.licensed || l.isCreator ? (
                  <button
                    type="button"
                    disabled={busy}
                    className={buttonClass}
                    onClick={() =>
                      void run(async () => {
                        const a = await platform<{ id: string }>(`marketplace/${l.id}/import`, {
                          body: {},
                        });
                        router.push(`/agents/${encodeURIComponent(a.id)}`);
                      })
                    }
                  >
                    Import as draft
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !!pending}
                    className={buttonClass}
                    onClick={() => void run(() => buy(l))}
                  >
                    {l.priceUsdc ? "Buy license" : "Add to library"}
                  </button>
                )}
              </div>
              {l.isCreator && l.status === "published" && (
                <button
                  type="button"
                  disabled={busy}
                  className="mt-3 text-left text-[11px] text-slate-500 hover:text-white"
                  onClick={() =>
                    void run(async () => {
                      await platform(`marketplace/${l.id}/unlist`, { method: "PUT", body: {} });
                      await reload();
                    })
                  }
                >
                  Unlist this version
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
