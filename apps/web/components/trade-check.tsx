"use client";

import type { TradeCheckAnswer, TradeCheckReport } from "@sisera/domain";
import { ArrowRight, Check, Copy, ExternalLink, Loader2, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "../lib/platform";

const EXAMPLES = [
  { label: "SISERA", mint: "4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5" },
  { label: "JUP", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
];
const QUESTIONS = [
  "What should I check before buying?",
  "How easy could it be to sell?",
  "Are large holders a concern?",
];
const money = (value: number | null | undefined) =>
  value == null
    ? "Unavailable"
    : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
const price = (value: number | null | undefined) =>
  value == null
    ? "Unavailable"
    : `$${Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(value)}`;

export function TradeCheck({ initialInput }: { initialInput: string }) {
  const [input, setInput] = useState(initialInput);
  const [report, setReport] = useState<TradeCheckReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<Array<TradeCheckAnswer & { question: string }>>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const requestId = useRef(0);
  const activeMint = useRef<string | null>(null);
  const initial = useRef(false);

  const run = useCallback(async (value: string) => {
    const id = ++requestId.current;
    activeMint.current = null;
    setInput(value);
    setReport(null);
    setAnswers([]);
    setChatError(null);
    setError(null);
    setLoading(true);
    try {
      const result = await platform<TradeCheckReport>(
        `trade-check?${new URLSearchParams({ input: value.trim() })}`,
      );
      if (id !== requestId.current) return;
      activeMint.current = result.mint;
      setReport(result);
      window.history.replaceState(
        null,
        "",
        `/trade-check?${new URLSearchParams({ token: result.mint })}`,
      );
    } catch (cause) {
      if (id === requestId.current)
        setError(cause instanceof Error ? cause.message : "This token could not be checked.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (initial.current) return;
    initial.current = true;
    if (initialInput) void run(initialInput);
  }, [initialInput, run]);

  async function ask(text: string) {
    if (!report || !text.trim() || asking) return;
    const mint = report.mint;
    const version = requestId.current;
    setAsking(true);
    setChatError(null);
    setQuestion("");
    try {
      const result = await platform<TradeCheckAnswer>("trade-check/chat", {
        body: { input: mint, question: text },
      });
      if (activeMint.current === mint && requestId.current === version)
        setAnswers((previous) => [...previous, { ...result, question: text }]);
    } catch (cause) {
      if (activeMint.current === mint && requestId.current === version)
        setChatError(
          cause instanceof Error && /session|unauthorized|sign in/i.test(cause.message)
            ? "Sign in to ask follow-up questions. You can still read all token checks and sources."
            : cause instanceof Error
              ? cause.message
              : "The follow-up is unavailable.",
        );
    } finally {
      setAsking(false);
    }
  }
  const attention = report?.checks.filter((item) => item.status === "attention").length ?? 0;
  const unknown = report?.checks.filter((item) => item.status === "unknown").length ?? 0;

  return (
    <div className="min-h-full bg-ink text-bone">
      <div className="border-b border-line px-5 py-7 md:px-8">
        <div className="mb-5 flex items-center gap-2 text-[11px] uppercase tracking-[.18em] text-bronze-300">
          <ShieldCheck size={14} /> Trade Check{" "}
          <span className="ml-auto text-slate-500">Solana · Read only</span>
        </div>
        <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
          Before you hit buy,
          <br className="sm:hidden" /> check the token.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
          Price moves, liquidity, large holders and recent news. One brief, with the evidence
          attached.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(input);
          }}
          className="mt-6 flex max-w-4xl flex-col gap-2 sm:flex-row"
        >
          <label className="flex min-w-0 flex-1 items-center gap-3 border border-line-strong bg-panel px-4 focus-within:border-bronze-300">
            <Search size={17} className="shrink-0 text-slate-500" />
            <input
              aria-label="Solana token address or token link"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste a Solana token address or token link"
              maxLength={512}
              spellCheck={false}
              autoComplete="off"
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500"
            />
          </label>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-12 items-center justify-center gap-3 bg-bronze-300 px-6 text-sm font-semibold text-ink hover:bg-bronze-200 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Checking token
              </>
            ) : (
              <>
                Check token <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>Try a token</span>
          {EXAMPLES.map((example) => (
            <button
              type="button"
              key={example.mint}
              disabled={loading}
              onClick={() => void run(example.mint)}
              className="border-b border-line py-1 text-slate-300 hover:border-bronze-300 hover:text-bronze-300"
            >
              {example.label}
            </button>
          ))}
          <span className="sm:ml-2">Pump.fun, Solscan and Clawpump token links supported</span>
        </div>
      </div>
      <div aria-live="polite" className="p-5 md:p-8">
        {error && (
          <div
            role="alert"
            className="max-w-4xl border border-amber-400/30 bg-amber-400/5 p-5 text-sm text-amber-100"
          >
            {error}
          </div>
        )}
        {loading && (
          <output className="block max-w-4xl space-y-4 border border-line bg-panel p-6">
            <p className="flex items-center gap-3 text-sm">
              <Loader2 size={16} className="animate-spin text-bronze-300" /> Reading pool activity,
              checking the mint and looking for related reports…
            </p>
            <p className="text-xs text-slate-400">
              This usually takes a few seconds. Missing data will be shown as unavailable.
            </p>
            <div className="h-20 animate-pulse bg-ink-raised" />
          </output>
        )}
        {!loading && !report && !error && (
          <div className="grid max-w-5xl gap-px border border-line bg-line sm:grid-cols-3">
            {[
              ["01", "See the move", "Check recent price activity and the pools behind it."],
              ["02", "Check the risks", "Review liquidity, sampled holders and token controls."],
              ["03", "Ask a follow-up", "Explore the same evidence in plain English."],
            ].map(([step, title, detail]) => (
              <div key={step} className="bg-ink-raised p-6">
                <span className="font-mono text-xs text-bronze-300">{step}</span>
                <h2 className="mt-5 text-lg">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
              </div>
            ))}
          </div>
        )}
        {report && !loading && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs text-bronze-300">TOKEN BRIEF</p>
                <h2 className="mt-2 text-2xl">
                  {report.name}{" "}
                  <span className="ml-2 text-base text-slate-400">{report.symbol}</span>
                </h2>
                <button
                  type="button"
                  title="Copy token address"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(report.mint);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      setError("Copy is unavailable. Select the token address instead.");
                    }
                  }}
                  className="mt-2 flex max-w-full items-center gap-2 break-all font-mono text-[11px] text-slate-500"
                >
                  {report.mint}
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              <p className="text-xs leading-5 text-slate-500">
                Checked {new Date(report.checkedAt).toLocaleTimeString()}
                <br />
                Snapshot cached for up to 60 seconds
              </p>
            </div>
            <div className="grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Price", price(report.market?.priceUsd)],
                [
                  "24h move",
                  report.market?.change24hPct == null
                    ? "Unavailable"
                    : `${report.market.change24hPct > 0 ? "+" : ""}${report.market.change24hPct.toFixed(2)}%`,
                ],
                ["Observed pool liquidity", money(report.market?.liquidityUsd)],
                ["24h trading volume", money(report.market?.volume24hUsd)],
              ].map(([label, value]) => (
                <div key={label} className="bg-panel p-5">
                  <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
                  <p className="mt-3 font-mono text-2xl">{value}</p>
                </div>
              ))}
            </div>
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
              <div className="space-y-6">
                <section className="border border-line bg-ink-raised">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-5">
                    <h3 className="text-base font-medium">The quick read</h3>
                    <span className="text-xs text-slate-400">
                      {attention} to review · {unknown} evidence gap{unknown === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="p-5 text-base leading-7 text-bone-dim">{report.summary}</p>
                  <div className="border-t border-line px-5 py-3 text-[11px] leading-5 text-slate-500">
                    Data brief · These checks are not a buy signal or a safety certification. No
                    wallet connection or transaction is required.
                  </div>
                </section>
                <section className="border border-line">
                  <div className="border-b border-line p-5">
                    <h3 className="font-medium">What to check</h3>
                  </div>
                  {report.checks.map((item) => (
                    <article
                      key={item.id}
                      className="grid gap-2 border-b border-line p-5 last:border-0 sm:grid-cols-[145px_1fr]"
                    >
                      <div>
                        <p className="text-sm font-medium">{item.title}</p>
                        <span
                          className={`mt-2 inline-block text-[10px] uppercase tracking-wider ${item.status === "attention" ? "text-amber-200" : item.status === "unknown" ? "text-slate-500" : "text-verdigris-300"}`}
                        >
                          {item.status === "attention"
                            ? "Review closely"
                            : item.status === "unknown"
                              ? "Missing evidence"
                              : "Data observed"}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-slate-400">{item.detail}</p>
                    </article>
                  ))}
                </section>
                <section className="border border-line">
                  <div className="flex items-center justify-between border-b border-line p-5">
                    <h3 className="font-medium">Related headlines</h3>
                    <span className="text-[11px] text-slate-500">Last 14 days</span>
                  </div>
                  {report.news.length ? (
                    report.news.map((item) => (
                      <a
                        key={item.url}
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block border-b border-line p-5 last:border-0 hover:bg-panel"
                      >
                        <span className="flex items-start justify-between gap-4 text-sm leading-6">
                          {item.title}
                          <ExternalLink size={14} className="mt-1 shrink-0 text-slate-500" />
                        </span>
                        <span className="mt-2 block text-[11px] text-slate-500">
                          {item.publisher} · {new Date(item.publishedAt).toLocaleDateString()}
                        </span>
                      </a>
                    ))
                  ) : (
                    <p className="p-5 text-sm leading-6 text-slate-400">
                      {report.newsStatus === "unavailable"
                        ? "News coverage is unavailable for this check."
                        : "No matching recent headlines in the available feeds."}{" "}
                      The cause of the price move remains unverified.
                    </p>
                  )}
                </section>
              </div>
              <div className="space-y-6">
                <section className="border border-line bg-panel">
                  <div className="border-b border-line p-5">
                    <h3 className="font-medium">Ask about this token</h3>
                    <p className="mt-2 text-xs leading-5 text-slate-400">
                      Answers use this token’s evidence. Follow-ups require sign-in.
                    </p>
                  </div>
                  <div className="space-y-2 p-5">
                    {QUESTIONS.map((text) => (
                      <button
                        type="button"
                        key={text}
                        disabled={asking}
                        onClick={() => void ask(text)}
                        className="flex w-full items-center justify-between gap-3 border border-line bg-ink px-3 py-3 text-left text-xs text-slate-300 hover:border-bronze-400 disabled:opacity-50"
                      >
                        {text}
                        <ArrowRight size={13} className="shrink-0" />
                      </button>
                    ))}
                  </div>
                  <div className="space-y-4 px-5">
                    {answers.map((answer, i) => (
                      <div key={`${i}-${answer.question}`} className="border-t border-line pt-4">
                        <p className="text-sm font-medium text-bronze-200">{answer.question}</p>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                          {answer.answer}
                        </p>
                        <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">
                          {answer.mode === "ai"
                            ? "AI explanation · snapshot sources"
                            : "Data explanation · AI narration unavailable"}
                          {` · ${new Date(answer.checkedAt).toLocaleTimeString()}`}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3">
                          {answer.sources.map((source) => {
                            return (
                              <a
                                key={source.id}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-verdigris-300 underline"
                              >
                                {source.label}
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {asking && (
                      <output className="flex items-center gap-2 pb-4 text-xs text-slate-400">
                        <Loader2 size={13} className="animate-spin" /> Reading the evidence…
                      </output>
                    )}
                    {chatError && (
                      <p role="alert" className="pb-4 text-xs leading-5 text-amber-200">
                        {chatError}
                      </p>
                    )}
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void ask(question);
                    }}
                    className="flex gap-2 p-5"
                  >
                    <input
                      aria-label="Ask a follow-up about this token"
                      value={question}
                      maxLength={500}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="Ask a follow-up…"
                      className="h-10 min-w-0 flex-1 border border-line bg-ink px-3 text-xs outline-none focus:border-bronze-300"
                    />
                    <button
                      type="submit"
                      aria-label="Send follow-up"
                      disabled={asking || !question.trim()}
                      className="border border-bronze-400/40 px-3 text-bronze-300 disabled:opacity-40"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </form>
                </section>
                <section className="border border-line p-5">
                  <h3 className="text-sm font-medium">Evidence & coverage</h3>
                  <div className="mt-4 space-y-4">
                    {report.sources.map((source) => (
                      <div key={source.id}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-start justify-between gap-3 text-xs text-slate-300 hover:text-bronze-300"
                        >
                          {source.label}
                          <ExternalLink size={12} className="shrink-0" />
                        </a>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {source.status === "available" ? "Observed" : "Unavailable"} ·{" "}
                          {new Date(source.observedAt).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-5 border-t border-line pt-4 text-[11px] leading-5 text-slate-500">
                    Pool figures cover observed base-token pairs. Holder percentages aggregate
                    wallet owners within a sample of the largest token accounts. Missing information
                    stays unknown.
                  </p>
                </section>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
