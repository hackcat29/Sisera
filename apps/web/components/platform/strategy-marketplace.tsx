"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { platform } from "../../lib/platform";
import { useSolanaSigner } from "../../lib/use-solana-signer";
import { Panel, Stat } from "./ui";

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

type Performance = {
  trades: number;
  closedTrades: number;
  feeAdjustedRealizedUsd: number | null;
  winRatePct: number | null;
  realizedDrawdownUsd: number | null;
  observedDays: number;
  unmatchedSells: number;
  status: string;
  curve: Array<{ time: string; pnlUsd: number }>;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
};
type StrategyEvidence = {
  live: Performance;
  paper: Performance;
  verified: Performance;
  coverage: string;
  updatedAt: string;
  evaluations: Array<{
    id: string;
    stage: string;
    outcome: string;
    engineRecorded: boolean;
    windowStart: string | null;
    windowEnd: string | null;
    evidence?: {
      perSymbol?: Array<{
        entry: string;
        source?: string;
        basis?: string;
        years?: number;
        metrics?: Record<string, number | null>;
      }>;
      stats?: Record<string, number | null>;
    };
  }>;
};
type Detail = {
  id: string;
  version: string;
  performance: StrategyEvidence;
  canReview: boolean;
  reviews: Array<{ rating: number; comment: string; isOwn: boolean; updatedAt: string }>;
  evaluations: StrategyEvidence["evaluations"];
  rules: unknown;
  trades: Array<{
    mode: string;
    symbol: string;
    side: string;
    quantity: number;
    priceUsd: number;
    feeUsd: number;
    time: string;
    verified: boolean;
    explorerUrl: string | null;
  }>;
};
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
  performance?: StrategyEvidence;
  reputation?: { rating: number | null; reviewCount: number; licenses: number };
  creator?: { listings: number; licenses: number; rating: number | null; reviews: number };
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
  const [sort, setSort] = useState("recent");
  const [history, setHistory] = useState("all");
  const [detail, setDetail] = useState<Detail | null>(null);
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
        )
        .filter(
          (l) =>
            history === "all" ||
            (history === "verified"
              ? (l.performance?.verified.trades ?? 0) > 0
              : (l.performance?.live.trades ?? 0) > 0),
        )
        .sort((a, b) =>
          sort === "licenses"
            ? (b.reputation?.licenses ?? 0) - (a.reputation?.licenses ?? 0)
            : sort === "rating"
              ? (b.reputation?.rating ?? -1) - (a.reputation?.rating ?? -1)
              : sort === "pnl"
                ? (b.performance?.verified.status === "recorded"
                    ? (b.performance.verified.feeAdjustedRealizedUsd ?? Number.NEGATIVE_INFINITY)
                    : Number.NEGATIVE_INFINITY) -
                  (a.performance?.verified.status === "recorded"
                    ? (a.performance.verified.feeAdjustedRealizedUsd ?? Number.NEGATIVE_INFINITY)
                    : Number.NEGATIVE_INFINITY)
                : 0,
        ),
    [listings, tab, category, search, sort, history],
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
              Payout: {signer.address ?? "Connect a Solana wallet"}
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
        <select
          aria-label="Filter performance history"
          value={history}
          onChange={(e) => setHistory(e.target.value)}
          className={inputClass}
        >
          <option value="all">All histories</option>
          <option value="live">Recorded live</option>
          <option value="verified">Onchain verified</option>
        </select>
        <select
          aria-label="Sort strategies"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className={inputClass}
        >
          <option value="recent">Newest</option>
          <option value="licenses">Most licensed</option>
          <option value="rating">Buyer rating</option>
          <option value="pnl">Verified realized P&amp;L</option>
        </select>
      </div>
      {detail && (
        <EvidencePanel
          detail={detail}
          busy={busy}
          close={() => setDetail(null)}
          review={(rating, comment) =>
            void run(async () => {
              await platform(`marketplace/${detail.id}/reviews`, { body: { rating, comment } });
              setDetail(await platform<Detail>(`marketplace/${detail.id}`));
              await reload();
              setMessage("Review saved.");
            })
          }
        />
      )}
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
              <p className="mt-3 line-clamp-2 flex-1 text-xs leading-5 text-slate-400">
                {l.description}
              </p>
              <p className="mt-4 truncate font-mono text-[10px] text-slate-500">
                {l.universe.join(" · ")}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-400">
                <span className="text-bronze-200">{l.evaluation}</span>
                <span>{plural(l.reputation?.licenses ?? 0, "license")}</span>
                <span>
                  {l.reputation?.rating?.toFixed(1) ?? "—"} / 5 ·{" "}
                  {plural(l.reputation?.reviewCount ?? 0, "review")}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500">Verified realized P&amp;L</span>
                  <p className="mt-1 font-mono text-bone">
                    {l.performance?.verified.status === "recorded" &&
                    l.performance.verified.feeAdjustedRealizedUsd != null
                      ? `$${l.performance.verified.feeAdjustedRealizedUsd.toFixed(2)}`
                      : "—"}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Verified fills</span>
                  <p className="mt-1 font-mono text-bone">{l.performance?.verified.trades ?? 0}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                className="mt-3 text-left text-xs text-bronze-200"
                onClick={() =>
                  void run(async () => {
                    const next = await platform<Detail>(`marketplace/${l.id}`);
                    setDetail(next);
                    await reload();
                  })
                }
              >
                View evidence &amp; reviews →
              </button>
              {l.creator && (
                <details className="mt-2 text-[11px] text-slate-400">
                  <summary className="cursor-pointer">Creator history</summary>
                  <p className="mt-1">
                    {plural(l.creator.listings, "strategy", "strategies")} ·{" "}
                    {plural(l.creator.licenses, "license")} · {l.creator.rating?.toFixed(1) ?? "—"}{" "}
                    / 5 ({plural(l.creator.reviews, "review")})
                  </p>
                </details>
              )}
              {l.isCreator && (
                <p className="mt-3 text-xs text-slate-300">
                  {plural(l.sales ?? 0, "license")} · {(l.earnedUsdc ?? 0).toFixed(2)} USDC earned
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

function EvidencePanel({
  detail,
  busy,
  close,
  review,
}: {
  detail: Detail;
  busy: boolean;
  close: () => void;
  review: (rating: number, comment: string) => void;
}) {
  const [mode, setMode] = useState<"verified" | "live" | "paper">("verified");
  const p = detail.performance[mode];
  const curve = p.curve;
  const low = Math.min(0, ...curve.map((v) => v.pnlUsd));
  const high = Math.max(1, ...curve.map((v) => v.pnlUsd));
  const points = curve
    .map(
      (v, i) =>
        `${10 + (i / Math.max(1, curve.length - 1)) * 580},${110 - ((v.pnlUsd - low) / (high - low)) * 100}`,
    )
    .join(" ");
  return (
    <Panel title={`Strategy evidence · v${detail.version}`}>
      <div className="space-y-4 p-4 text-xs">
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {(["verified", "live", "paper"] as const).map((m) => (
              <button
                type="button"
                key={m}
                className={`${buttonClass} ${mode === m ? "bg-bronze-300/10" : ""}`}
                onClick={() => setMode(m)}
              >
                {m === "verified" ? "Onchain verified" : m === "live" ? "Recorded live" : "Paper"}
              </button>
            ))}
          </div>
          <button type="button" onClick={close} className={buttonClass}>
            Close
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat
            label="Realized trade P&L"
            value={
              p.status === "recorded" && p.feeAdjustedRealizedUsd != null
                ? `$${p.feeAdjustedRealizedUsd.toFixed(2)}`
                : "—"
            }
          />
          <Stat label="Closed trades" value={p.closedTrades} />
          <Stat
            label="Win rate"
            value={p.winRatePct != null ? `${p.winRatePct.toFixed(1)}%` : "—"}
          />
          <Stat
            label="Realized drawdown"
            value={p.realizedDrawdownUsd != null ? `$${p.realizedDrawdownUsd.toFixed(2)}` : "—"}
          />
        </div>
        <p className="text-slate-500">
          {p.trades} fills · {p.observedDays} observed days · {p.status.replaceAll("_", " ")} ·
          trade fees included
        </p>
        {curve.length > 0 && p.status === "recorded" && (
          <svg
            role="img"
            aria-label="Cumulative realized trade profit in dollars"
            viewBox="0 0 600 130"
            className="h-32 w-full border border-line"
          >
            <title>Cumulative realized trade profit in dollars</title>
            <line
              x1="10"
              x2="590"
              y1={110 - (-low / (high - low)) * 100}
              y2={110 - (-low / (high - low)) * 100}
              stroke="#475569"
            />
            <polyline points={points} fill="none" stroke="#caa878" strokeWidth="2" />
            <text x="10" y="125" fill="#94a3b8" fontSize="9">
              {curve[0]?.time.slice(0, 10)}
            </text>
            <text x="500" y="125" fill="#94a3b8" fontSize="9">
              {curve.at(-1)?.time.slice(0, 10)}
            </text>
          </svg>
        )}
        <details>
          <summary className="cursor-pointer text-bronze-200">
            Coverage & evaluation history
          </summary>
          <p className="mt-2 text-slate-400">{detail.performance.coverage}</p>
          <div className="mt-2 space-y-2">
            {detail.evaluations.map((e) => (
              <p key={e.id} className="text-slate-400">
                {e.stage.replaceAll("_", " ")} · {e.outcome} ·{" "}
                {e.engineRecorded ? "Sisera engine" : "Submitted evidence"} ·{" "}
                {e.windowStart?.slice(0, 10) ?? "—"} – {e.windowEnd?.slice(0, 10) ?? "—"}
              </p>
            ))}
            {detail.evaluations.map((e) => (
              <div key={`metrics-${e.id}`} className="space-y-2 text-slate-400">
                {e.evidence?.perSymbol?.map((row) => (
                  <div key={row.entry}>
                    <p className="text-bronze-200">
                      {row.entry} · {row.source} · {row.years?.toFixed(1) ?? "—"} years
                    </p>
                    <p>{row.basis}</p>
                    {row.metrics && (
                      <div className="mt-1 flex flex-wrap gap-3">
                        {Object.entries(row.metrics).map(([key, value]) => (
                          <span key={key}>
                            {key.replace(/([A-Z])/g, " $1")}: {value?.toFixed(2) ?? "—"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {e.evidence?.stats && (
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(e.evidence.stats).map(([key, value]) => (
                      <span key={key}>
                        {key.replace(/([A-Z])/g, " $1")}: {value?.toFixed(2) ?? "—"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!detail.evaluations.length && <p className="text-slate-500">No evaluations.</p>}
          </div>
        </details>
        <details>
          <summary className="cursor-pointer text-bronze-200">Trade history</summary>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left">
              <thead className="text-slate-500">
                <tr>
                  <th>Time</th>
                  <th>Asset</th>
                  <th>Mode</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Fee</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {detail.trades.map((t, i) => (
                  <tr key={`${t.time}-${i}`} className="border-t border-line text-slate-300">
                    <td className="py-2">{new Date(t.time).toLocaleDateString()}</td>
                    <td>{t.symbol}</td>
                    <td>{t.mode}</td>
                    <td>{t.side}</td>
                    <td>{Number(t.quantity).toFixed(4)}</td>
                    <td>${Number(t.priceUsd).toFixed(2)}</td>
                    <td>${Number(t.feeUsd).toFixed(2)}</td>
                    <td>
                      {t.explorerUrl ? (
                        <a
                          className="text-bronze-200"
                          href={t.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t.verified ? "Finalized" : "Recorded"} ↗
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        {detail.rules != null && (
          <details>
            <summary className="cursor-pointer text-bronze-200">Licensed rules</summary>
            <pre className="mt-2 max-h-64 overflow-auto text-[11px] text-slate-400">
              {JSON.stringify(detail.rules, null, 2)}
            </pre>
          </details>
        )}
        <div className="border-t border-line pt-3">
          <p className="text-bronze-200">License holder reviews</p>
          <div className="mt-2 space-y-2">
            {detail.reviews.map((r, i) => (
              <div key={`${r.updatedAt}-${i}`} className="border border-line p-3 text-slate-400">
                <span className="text-bone">
                  {r.rating} / 5 {r.isOwn ? "· Your review" : ""}
                </span>
                <p className="mt-1">{r.comment}</p>
              </div>
            ))}
            {!detail.reviews.length && <p className="text-slate-500">No reviews yet.</p>}
          </div>
          {detail.canReview && (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                review(Number(form.get("rating")), String(form.get("comment") ?? ""));
              }}
            >
              <select
                aria-label="Your rating"
                name="rating"
                className={inputClass}
                defaultValue="5"
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} / 5
                  </option>
                ))}
              </select>
              <input
                name="comment"
                aria-label="Your review"
                maxLength={500}
                placeholder="Your experience"
                className={inputClass}
              />
              <button type="submit" disabled={busy} className={buttonClass}>
                Save review
              </button>
            </form>
          )}
        </div>
      </div>
    </Panel>
  );
}
