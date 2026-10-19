"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type CatalogAsset, ago, platform, usd } from "../../lib/platform";
import { useSolanaSigner } from "../../lib/use-solana-signer";
import { useLiveCapability } from "../use-live-capability";
import { Loading, Note, Panel, buttonClass, ghostButtonClass, inputClass } from "./ui";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type Pairs = {
  assets: Array<{ mint: string; symbol: string; name: string; decimals: number }>;
  creatorFeeBps: { min: number; max: number; default: number };
};
type Preset = {
  id: string;
  label: string;
  description: string;
  graduationMultiple: number;
  lockedVestingPct: number;
  creatorTradingFeePct: number;
  fee: { startingBps: number; endingBps: number };
};
type Launch = {
  id: string;
  venue: string;
  status: string;
  name: string;
  symbol: string;
  quoteSymbol: string;
  referenceSymbol: string | null;
  baseMint: string | null;
  createdAt: string;
  error: string | null;
};
type AgentOption = { id: string; name: string; stage: string };

function useAgents() {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  useEffect(() => {
    fetch("/api/platform/agents", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { custom: [] }))
      .then((payload: { custom?: AgentOption[] }) => setAgents(payload.custom ?? []))
      .catch(() => setAgents([]));
  }, []);
  return agents;
}

function Field({
  label,
  children,
  hint,
}: { label: string; children: React.ReactNode; hint?: string | undefined }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className="block text-xs text-slate-300">
      {label}
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[10px] text-slate-500">{hint}</p>}
    </label>
  );
}

function ClawpumpLaunch({
  agentId,
  onLaunched,
}: { agentId: string | null; onLaunched: () => void }) {
  const signer = useSolanaSigner();
  const [pairs, setPairs] = useState<Pairs | null>(null);
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    description: "",
    imageUrl: "",
    pairMint: SOL,
    creatorFeeBps: 100,
    devBuySol: 0,
    website: "",
    twitter: "",
  });
  const [quote, setQuote] = useState<{
    launch: Launch;
    transactions: string[];
    payment: { amountSol: number; payTo: string; expiresAt: string };
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{
    tone: "warning" | "positive" | "error";
    text: string;
  } | null>(null);
  useEffect(() => {
    platform<Pairs>("clawpump/pairs")
      .then(setPairs)
      .catch((reason: Error) => setMessage({ tone: "warning", text: reason.message }));
  }, []);
  const pair = pairs?.assets.find((asset) => asset.mint === form.pairMint);
  const stockPair = pair && ![SOL, USDC].includes(pair.mint);
  const requestQuote = async () => {
    setWorking(true);
    setMessage(null);
    try {
      const body = {
        ...(agentId ? { agentId } : {}),
        name: form.name,
        symbol: form.symbol,
        description: form.description,
        imageUrl: form.imageUrl,
        wallet: signer.address,
        ...(form.pairMint !== SOL
          ? { pairMint: form.pairMint, creatorFeeBps: form.creatorFeeBps }
          : {}),
        devBuySol: form.devBuySol,
        ...(form.website ? { website: form.website } : {}),
        ...(form.twitter ? { twitter: form.twitter } : {}),
      };
      setQuote(await platform("launches/clawpump/quote", { body }));
    } catch (reason) {
      setMessage({
        tone: "error",
        text: reason instanceof Error ? reason.message : "The launch could not be quoted.",
      });
    } finally {
      setWorking(false);
    }
  };
  const payAndLaunch = async () => {
    if (!quote) return;
    setWorking(true);
    setMessage(null);
    try {
      const signedTransactions = await signer.signAll(quote.transactions);
      const launch = await platform<Launch>(`launches/${quote.launch.id}/submit`, {
        body: { signedTransactions },
      });
      setMessage({
        tone: launch.status === "failed" ? "error" : "positive",
        text:
          launch.status === "launched"
            ? `Launched ${launch.symbol}.`
            : launch.status === "failed"
              ? (launch.error ?? "Launch failed.")
              : "Payment confirmed; Clawpump is finishing the launch.",
      });
      setQuote(null);
      onLaunched();
    } catch (reason) {
      setMessage({
        tone: "error",
        text: reason instanceof Error ? reason.message : "The launch failed.",
      });
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="space-y-3 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Token name">
          <input
            className={inputClass}
            maxLength={32}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="Symbol">
          <input
            className={inputClass}
            maxLength={10}
            value={form.symbol}
            onChange={(event) => setForm({ ...form, symbol: event.target.value.toUpperCase() })}
          />
        </Field>
      </div>
      <Field
        label="Description"
        hint="20–500 characters. State the strategy and that decisions are made by Sisera's governed runtime."
      >
        <textarea
          className={`${inputClass} h-20 py-2`}
          maxLength={500}
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </Field>
      <Field label="Image URL (https)">
        <input
          className={inputClass}
          value={form.imageUrl}
          onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
        />
      </Field>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Pair" hint={stockPair ? "Stock-paired market" : "Standard pair"}>
          <select
            className={inputClass}
            value={form.pairMint}
            onChange={(event) => setForm({ ...form, pairMint: event.target.value })}
          >
            {(pairs?.assets ?? [{ mint: SOL, symbol: "SOL", name: "Solana", decimals: 9 }]).map(
              (asset) => (
                <option key={asset.mint} value={asset.mint}>
                  {asset.symbol} — {asset.name}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field
          label={`Creator fee (${(form.creatorFeeBps / 100).toFixed(1)}%)`}
          hint={
            form.pairMint === SOL
              ? "SOL pairs use the standard fee"
              : "75% of fees go to your payout wallet"
          }
        >
          <input
            type="range"
            min={pairs?.creatorFeeBps.min ?? 100}
            max={pairs?.creatorFeeBps.max ?? 300}
            step={25}
            disabled={form.pairMint === SOL}
            value={form.creatorFeeBps}
            onChange={(event) => setForm({ ...form, creatorFeeBps: Number(event.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label="Initial buy (SOL)">
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.devBuySol}
            onChange={(event) => setForm({ ...form, devBuySol: Number(event.target.value) || 0 })}
          />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Website (optional)">
          <input
            className={inputClass}
            value={form.website}
            onChange={(event) => setForm({ ...form, website: event.target.value })}
          />
        </Field>
        <Field label="X profile (optional)">
          <input
            className={inputClass}
            value={form.twitter}
            onChange={(event) => setForm({ ...form, twitter: event.target.value })}
          />
        </Field>
      </div>
      {!quote ? (
        <button
          type="button"
          className={buttonClass}
          disabled={
            working ||
            !signer.address ||
            form.description.length < 20 ||
            !form.name ||
            !form.symbol ||
            !form.imageUrl.startsWith("https://")
          }
          onClick={requestQuote}
        >
          {working ? "Quoting…" : signer.address ? "Get launch quote" : "Connect a Solana wallet"}
        </button>
      ) : (
        <div className="space-y-2 border border-bronze-500/40 bg-ink p-3 text-xs">
          <p className="text-slate-200">
            Launch cost{" "}
            <span className="num text-bone">{quote.payment.amountSol.toFixed(5)} SOL</span> paid
            from {signer.address?.slice(0, 6)}… to Clawpump ({quote.payment.payTo.slice(0, 6)}…).
            Quote valid until {new Date(quote.payment.expiresAt).toLocaleTimeString()}.
          </p>
          <div className="flex gap-2">
            <button type="button" className={buttonClass} disabled={working} onClick={payAndLaunch}>
              {working ? "Launching…" : "Sign payment & launch"}
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              disabled={working}
              onClick={() => setQuote(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <Note tone={message.tone}>{message.text}</Note>}
    </div>
  );
}

function DbcLaunch({ agentId, onLaunched }: { agentId: string | null; onLaunched: () => void }) {
  const signer = useSolanaSigner();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [stocks, setStocks] = useState<CatalogAsset[]>([]);
  const [form, setForm] = useState({
    preset: "reference_anchored",
    name: "",
    symbol: "",
    description: "",
    imageUrl: "",
    quoteMint: SOL,
    initialMarketCap: 30,
    graduationMultiple: "",
    creatorTradingFeePct: "",
    firstBuyQuote: 0,
  });
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{
    tone: "warning" | "positive" | "error";
    text: string;
  } | null>(null);
  useEffect(() => {
    fetch("/api/platform/launches/dbc/presets", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { data?: Preset[] }) => setPresets(payload.data ?? []))
      .catch(() => setPresets([]));
    platform<CatalogAsset[]>("catalog/assets?kind=public_equity")
      .then((rows) =>
        setStocks(
          rows
            .filter((row) => (row.liquidityUsd ?? 0) > 50_000)
            .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
            .slice(0, 30),
        ),
      )
      .catch(() => setStocks([]));
  }, []);
  const quoteAsset = stocks.find((stock) => stock.mint === form.quoteMint);
  const quoteSymbol =
    form.quoteMint === SOL
      ? "SOL"
      : form.quoteMint === USDC
        ? "USDC"
        : (quoteAsset?.symbol ?? "quote");
  const body = useMemo(
    () => ({
      preset: form.preset,
      name: form.name,
      symbol: form.symbol,
      description: form.description,
      imageUrl: form.imageUrl,
      wallet: signer.address ?? "11111111111111111111111111111111",
      quoteMint: form.quoteMint,
      initialMarketCap: Number(form.initialMarketCap),
      ...(form.graduationMultiple ? { graduationMultiple: Number(form.graduationMultiple) } : {}),
      ...(form.creatorTradingFeePct
        ? { creatorTradingFeePct: Number(form.creatorTradingFeePct) }
        : {}),
      firstBuyQuote: Number(form.firstBuyQuote) || 0,
      ...(quoteAsset ? { referenceSymbol: quoteAsset.symbol } : {}),
      ...(agentId ? { agentId } : {}),
    }),
    [form, signer.address, quoteAsset, agentId],
  );
  const runPreview = async () => {
    setWorking(true);
    setMessage(null);
    try {
      setPreview(await platform("launches/dbc/preview", { body }));
    } catch (reason) {
      setMessage({
        tone: "error",
        text: reason instanceof Error ? reason.message : "Preview failed.",
      });
    } finally {
      setWorking(false);
    }
  };
  const launch = async () => {
    setWorking(true);
    setMessage(null);
    try {
      const prepared = await platform<{ launch: Launch; transactions: string[] }>(
        "launches/dbc/prepare",
        { body },
      );
      const signedTransactions = await signer.signAll(prepared.transactions);
      const result = await platform<Launch>(`launches/${prepared.launch.id}/submit`, {
        body: { signedTransactions },
      });
      setMessage({
        tone: result.status === "launched" ? "positive" : "error",
        text:
          result.status === "launched"
            ? `Pool live for ${result.symbol}.`
            : (result.error ?? "Launch failed."),
      });
      onLaunched();
    } catch (reason) {
      setMessage({
        tone: "error",
        text: reason instanceof Error ? reason.message : "Launch failed.",
      });
    } finally {
      setWorking(false);
    }
  };
  const selectedPreset = presets.find((preset) => preset.id === form.preset);
  const quoteUsd = form.quoteMint === USDC ? 1 : (quoteAsset?.priceUsd ?? null);
  return (
    <div className="space-y-3 p-4">
      <div className="grid gap-2 md:grid-cols-3">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => setForm({ ...form, preset: preset.id })}
            className={`border p-3 text-left text-xs ${form.preset === preset.id ? "border-bronze-300 bg-bronze-500/10" : "border-line bg-ink hover:border-line-strong"}`}
          >
            <p className="font-semibold text-bone">{preset.label}</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-400">{preset.description}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Token name">
          <input
            className={inputClass}
            maxLength={32}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="Symbol">
          <input
            className={inputClass}
            maxLength={10}
            value={form.symbol}
            onChange={(event) => setForm({ ...form, symbol: event.target.value.toUpperCase() })}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          className={`${inputClass} h-16 py-2`}
          maxLength={500}
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </Field>
      <Field label="Image URL">
        <input
          className={inputClass}
          value={form.imageUrl}
          onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
        />
      </Field>
      <div className="grid gap-3 md:grid-cols-4">
        <Field
          label="Quote asset"
          hint={quoteAsset ? `Stock-paired against ${quoteAsset.symbol}` : undefined}
        >
          <select
            className={inputClass}
            value={form.quoteMint}
            onChange={(event) => setForm({ ...form, quoteMint: event.target.value })}
          >
            <option value={SOL}>SOL</option>
            <option value={USDC}>USDC</option>
            {stocks.map((stock) => (
              <option key={stock.mint} value={stock.mint}>
                {stock.symbol} (stock)
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={`Starting value (${quoteSymbol})`}
          hint={quoteUsd ? `≈ ${usd(Number(form.initialMarketCap) * quoteUsd)}` : undefined}
        >
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.initialMarketCap}
            onChange={(event) =>
              setForm({ ...form, initialMarketCap: Number(event.target.value) || 0 })
            }
          />
        </Field>
        <Field
          label="Graduation multiple"
          hint={selectedPreset ? `Preset ${selectedPreset.graduationMultiple}×` : undefined}
        >
          <input
            className={inputClass}
            inputMode="decimal"
            placeholder={String(selectedPreset?.graduationMultiple ?? "")}
            value={form.graduationMultiple}
            onChange={(event) => setForm({ ...form, graduationMultiple: event.target.value })}
          />
        </Field>
        <Field label={`First buy (${quoteSymbol})`}>
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.firstBuyQuote}
            onChange={(event) =>
              setForm({ ...form, firstBuyQuote: Number(event.target.value) || 0 })
            }
          />
        </Field>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={ghostButtonClass}
          disabled={
            working || !form.name || !form.symbol || form.description.length < 20 || !form.imageUrl
          }
          onClick={runPreview}
        >
          Preview curve
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={working || !preview || !signer.address}
          onClick={launch}
        >
          {working ? "Working…" : signer.address ? "Sign & launch pool" : "Connect a Solana wallet"}
        </button>
      </div>
      {preview && (
        <div className="grid gap-2 border border-line bg-ink p-3 text-xs text-slate-300 md:grid-cols-2">
          <p>
            Start price:{" "}
            <span className="num text-bone">
              {Number(preview.startPrice).toExponential(4)} {quoteSymbol}
            </span>
          </p>
          <p>
            Graduates at:{" "}
            <span className="num text-bone">
              {Number(preview.graduationMarketCap).toLocaleString()} {quoteSymbol}
            </span>
            {quoteUsd ? ` (${usd(Number(preview.graduationMarketCap) * quoteUsd)})` : ""}
          </p>
          <p>
            Quote raised to graduate:{" "}
            <span className="num text-bone">
              {Number(preview.migrationQuoteThreshold).toLocaleString()} {quoteSymbol}
            </span>
          </p>
          <p>
            Supply: <span className="num">{Number(preview.totalSupply).toLocaleString()}</span> ·
            locked vesting {String(preview.lockedVestingPct)}%
          </p>
          <p>
            Fees {(Number((preview.fees as { startingBps: number }).startingBps) / 100).toFixed(1)}%
            → {(Number((preview.fees as { endingBps: number }).endingBps) / 100).toFixed(1)}% over{" "}
            {Math.round(Number((preview.fees as { decaySeconds: number }).decaySeconds) / 60)} min ·
            creator share {String(preview.creatorTradingFeePct)}%
          </p>
          <p>{String(preview.migration)}</p>
          {Array.isArray(preview.ladder) && (
            <p className="md:col-span-2">
              Price ladder:{" "}
              {(preview.ladder as Array<{ quoteIn: number; averagePrice: number }>)
                .map(
                  (step) =>
                    `${step.quoteIn.toFixed(2)} ${quoteSymbol} → avg ${step.averagePrice.toExponential(3)}`,
                )
                .join(" · ")}
            </p>
          )}
          {(preview.warnings as string[]).map((warning) => (
            <Note key={warning} tone="warning">
              {warning}
            </Note>
          ))}
        </div>
      )}
      {message && <Note tone={message.tone}>{message.text}</Note>}
    </div>
  );
}

export function LaunchStudio({ agentId: initialAgent }: { agentId: string | null }) {
  const enabled = useLiveCapability("launches");
  const agents = useAgents();
  const [agentId, setAgentId] = useState<string | null>(initialAgent);
  const [tab, setTab] = useState<"clawpump" | "dbc">("clawpump");
  const [launches, setLaunches] = useState<Launch[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    void refresh;
    platform<Launch[]>("launches")
      .then(setLaunches)
      .catch(() => setLaunches([]));
  }, [refresh]);
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[1.3fr_.7fr]">
      <Panel
        title={
          <div className="flex border border-line">
            {(
              [
                ["clawpump", "Clawpump agent token"],
                ["dbc", "Meteora DBC pool"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`px-3 py-1.5 text-xs ${tab === value ? "bg-bronze-300 text-ink" : "text-slate-300"}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
        actions={
          <select
            aria-label="Agent"
            className="h-8 border border-line bg-ink px-2 text-xs text-slate-300"
            value={agentId ?? ""}
            onChange={(event) => setAgentId(event.target.value || null)}
          >
            <option value="">No linked agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.stage})
              </option>
            ))}
          </select>
        }
      >
        {!enabled && (
          <div className="p-4 pb-0">
            <Note tone="warning">
              Launches are disabled on this deployment (SISERA_LIVE_LAUNCHES_ENABLED). You can still
              preview DBC curves.
            </Note>
          </div>
        )}
        {tab === "clawpump" ? (
          <ClawpumpLaunch agentId={agentId} onLaunched={() => setRefresh((value) => value + 1)} />
        ) : (
          <DbcLaunch agentId={agentId} onLaunched={() => setRefresh((value) => value + 1)} />
        )}
      </Panel>
      <Panel title="Your launches">
        {!launches && <Loading />}
        {launches?.length === 0 && <p className="p-4 text-xs text-slate-400">No launches yet.</p>}
        <ul>
          {launches?.map((launch) => (
            <li
              key={launch.id}
              className="border-b border-line/60 px-4 py-2.5 text-xs last:border-0"
            >
              <Link
                prefetch={false}
                href={`/launch/${launch.id}`}
                className="font-semibold text-bone hover:text-bronze-200"
              >
                {launch.symbol} · {launch.name}
              </Link>
              <p className="font-mono text-[10px] uppercase text-slate-500">
                {launch.venue === "clawpump" ? "Clawpump" : "Meteora DBC"} · {launch.quoteSymbol}{" "}
                pair · {launch.status.replace("_", " ")} · {ago(launch.createdAt)}
              </p>
              {launch.error && <p className="text-[11px] text-rose-300">{launch.error}</p>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

type Monitor = {
  launch: Launch & {
    poolAddress: string | null;
    signature: string | null;
    providerState: Record<string, unknown>;
  };
  curve: {
    priceInQuote: number;
    quoteReserve: number;
    migrationQuoteThreshold: number;
    curveProgressPct: number | null;
    graduated: boolean;
    fees: {
      totalTradingQuoteFee: number;
      creatorUnclaimedQuoteFee: number;
      partnerUnclaimedQuoteFee: number;
    } | null;
  } | null;
  market: {
    priceUsd: number | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    change24hPct: number | null;
    marketCapUsd: number | null;
  } | null;
  pricing: {
    priceUsd: number | null;
    quoteUsd: number | null;
    priceInReference: number | null;
    changeFromLaunchPct: number | null;
  };
  observedAt: string;
};

export function LaunchMonitor({ id }: { id: string }) {
  const [data, setData] = useState<Monitor | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      platform<Monitor>(`launches/${id}/monitor`)
        .then((value) => {
          setData(value);
          setError(null);
        })
        .catch((reason: Error) => setError(reason.message));
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [id]);
  if (error)
    return (
      <div className="p-4">
        <Note tone="warning">{error}</Note>
      </div>
    );
  if (!data) return <Loading />;
  const { launch, curve, market, pricing } = data;
  return (
    <div className="space-y-4 p-4 md:px-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="border border-line bg-ink p-3">
          <p className="data-label text-slate-500">Status</p>
          <p className="mt-1 text-lg capitalize text-bone">{launch.status.replace("_", " ")}</p>
          <p className="text-[11px] text-slate-500">
            {launch.venue === "clawpump" ? "Clawpump · Pump.fun" : "Meteora DBC"} ·{" "}
            {launch.quoteSymbol} pair
          </p>
        </div>
        <div className="border border-line bg-ink p-3">
          <p className="data-label text-slate-500">Price</p>
          <p className="num mt-1 text-lg text-bone">{usd(pricing.priceUsd)}</p>
          <p className="text-[11px] text-slate-500">
            {curve
              ? `${curve.priceInQuote.toExponential(4)} ${launch.quoteSymbol}`
              : "market price"}
          </p>
        </div>
        <div className="border border-line bg-ink p-3">
          <p className="data-label text-slate-500">Since launch</p>
          <p
            className={`num mt-1 text-lg ${(pricing.changeFromLaunchPct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}
          >
            {pricing.changeFromLaunchPct == null
              ? "—"
              : `${pricing.changeFromLaunchPct.toFixed(2)}%`}
          </p>
          {pricing.priceInReference != null && (
            <p className="text-[11px] text-slate-500">
              {pricing.priceInReference.toExponential(4)} {launch.referenceSymbol} per token
            </p>
          )}
        </div>
        <div className="border border-line bg-ink p-3">
          <p className="data-label text-slate-500">Liquidity · 24h volume</p>
          <p className="num mt-1 text-lg text-bone">{usd(market?.liquidityUsd)}</p>
          <p className="text-[11px] text-slate-500">{usd(market?.volume24hUsd)} volume</p>
        </div>
        <div className="border border-line bg-ink p-3">
          <p className="data-label text-slate-500">Mint</p>
          <p className="mt-1 truncate font-mono text-[11px] text-slate-300">
            {launch.baseMint ?? "pending"}
          </p>
          {launch.baseMint && (
            <Link
              href={`/clawpump/${launch.baseMint}`}
              className="text-[11px] text-bronze-200 hover:underline"
            >
              Open market →
            </Link>
          )}
        </div>
      </div>
      {curve && (
        <Panel title="Bonding curve">
          <div className="space-y-3 p-4 text-xs text-slate-300">
            <div>
              <div className="flex justify-between">
                <span>Graduation progress</span>
                <span className="num">
                  {curve.graduated
                    ? "graduated to DAMM v2"
                    : `${(curve.curveProgressPct ?? 0).toFixed(2)}%`}
                </span>
              </div>
              <div className="mt-1 h-2 bg-slate-800">
                <div
                  className="h-full bg-bronze-300"
                  style={{
                    width: `${curve.graduated ? 100 : Math.min(100, curve.curveProgressPct ?? 0)}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {curve.quoteReserve.toLocaleString()} /{" "}
                {curve.migrationQuoteThreshold.toLocaleString()} {launch.quoteSymbol} raised
              </p>
            </div>
            {curve.fees && (
              <p>
                Trading fees collected: {curve.fees.totalTradingQuoteFee.toFixed(4)}{" "}
                {launch.quoteSymbol} · creator unclaimed{" "}
                {curve.fees.creatorUnclaimedQuoteFee.toFixed(4)} · partner unclaimed{" "}
                {curve.fees.partnerUnclaimedQuoteFee.toFixed(4)}
              </p>
            )}
          </div>
        </Panel>
      )}
      <p className="font-mono text-[10px] text-slate-500">
        Observed {new Date(data.observedAt).toLocaleTimeString()} · refreshes every 15s
      </p>
    </div>
  );
}
