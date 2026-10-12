import { ArrowUpRight, BookOpen, Check, Minus } from "lucide-react";
import type { PredictionClaim, PredictionResearch } from "../lib/api";

export function PredictionResearchPanel({
  research,
  section = "all",
}: { research: PredictionResearch; section?: "all" | "brief" | "details" }) {
  const insights = research.insights;
  if (!insights)
    return (
      <section className="border border-line bg-panel p-5 text-sm text-slate-400">
        Event analysis is temporarily unavailable.
      </section>
    );
  const evidence = new Map(insights.evidence.map((item) => [item.id, item]));
  const cite = (claim: PredictionClaim) => (
    <div className="mt-2 flex flex-wrap gap-2">
      {claim.evidenceIds.map((id) => {
        const source = evidence.get(id);
        if (!source) return null;
        return (
          <a
            key={id}
            href={`#evidence-${id}`}
            className="text-[10px] text-bronze-300 underline decoration-bronze-300/30 underline-offset-4"
          >
            {source.publisher}
          </a>
        );
      })}
    </div>
  );
  return (
    <>
      {section !== "details" && (
        <section className="border border-line bg-panel" aria-labelledby="event-brief">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h2
              id="event-brief"
              className="flex items-center gap-2 text-sm font-semibold text-bone"
            >
              <BookOpen size={15} className="text-bronze-300" />
              Event intelligence
            </h2>
            <span className="font-mono text-[10px] text-slate-400">
              {insights.mode === "ai" ? "AI brief · cited evidence" : "Data brief · AI unavailable"}
            </span>
          </div>
          <div className="px-5 py-5">
            <p className="max-w-3xl text-[15px] leading-7 text-bone">
              {insights.brief.summary.text}
            </p>
            {cite(insights.brief.summary)}
          </div>
          <div className="grid border-t border-line md:grid-cols-2">
            {(
              [
                ["What supports YES", insights.brief.yesCase],
                ["What supports NO", insights.brief.noCase],
              ] as const
            ).map(([title, claims]) => (
              <div
                key={title}
                className="border-b border-line px-5 py-4 last:border-b-0 md:border-b-0 md:first:border-r"
              >
                <h3 className="data-label text-slate-300">{title}</h3>
                {claims.length ? (
                  <ul className="mt-3 space-y-4">
                    {claims.map((claim) => (
                      <li key={claim.text} className="text-[13px] leading-6 text-slate-300">
                        {claim.text}
                        {cite(claim)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[13px] leading-6 text-slate-500">
                    The available evidence does not establish a case for this side.
                  </p>
                )}
              </div>
            ))}
          </div>
          {insights.brief.watch.length > 0 && (
            <div className="border-t border-line px-5 py-4">
              <h3 className="data-label">What to watch</h3>
              <ul className="mt-3 space-y-3">
                {insights.brief.watch.map((claim) => (
                  <li key={claim.text} className="text-[13px] leading-6 text-slate-300">
                    {claim.text}
                    {cite(claim)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="border-t border-line px-5 py-3 text-[11px] leading-5 text-slate-500">
            Research interpretation, not an independently calibrated forecast. Quotes, issuer
            criteria, and related reporting are separate evidence sources. Updated{" "}
            {new Date(insights.generatedAt).toUTCString()}.
          </p>
        </section>
      )}
      {section !== "brief" && (
        <>
          <section className="border border-line bg-panel" aria-labelledby="technical-indices">
            <div className="border-b border-line px-5 py-3">
              <h2 id="technical-indices" className="text-sm font-semibold text-bone">
                Market structure & technical measures
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Observed positioning and execution conditions. Missing history stays unavailable.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-line xl:grid-cols-3">
              {[...insights.technical]
                .sort((a, b) => Number(a.value == null) - Number(b.value == null))
                .map((metric) => (
                  <div key={metric.label} className="bg-panel px-5 py-4">
                    <dt className="text-[11px] text-slate-400">{metric.label}</dt>
                    <dd className="num mt-2 text-xl text-bone">
                      {metric.value == null
                        ? "—"
                        : metric.value.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                      <span className="ml-1 text-xs text-slate-500">
                        {metric.value != null ? metric.unit : "Unavailable"}
                      </span>
                    </dd>
                    <p className="mt-2 text-[11px] leading-5 text-slate-500">{metric.detail}</p>
                  </div>
                ))}
            </dl>
          </section>
          <section className="border border-line bg-panel" aria-labelledby="fundamentals">
            <h2
              id="fundamentals"
              className="border-b border-line px-5 py-3 text-sm font-semibold text-bone"
            >
              Event fundamentals & resolution checks
            </h2>
            <div className="border-b border-line px-5 py-4">
              <h3 className="data-label">Questions to verify for this event</h3>
              <ul className="mt-3 space-y-2">
                {insights.questions.map((question) => (
                  <li key={question} className="text-[13px] leading-6 text-slate-300">
                    {question}
                  </li>
                ))}
              </ul>
            </div>
            <dl className="divide-y divide-line">
              {insights.fundamentals.map((item) => (
                <div key={item.label} className="grid gap-2 px-5 py-3 sm:grid-cols-[170px_1fr]">
                  <dt className="flex items-center gap-2 text-xs text-slate-300">
                    {item.status === "available" ? (
                      <Check size={13} className="text-bronze-300" />
                    ) : (
                      <Minus size={13} className="text-slate-600" />
                    )}
                    {item.label}
                  </dt>
                  <dd className="text-xs leading-6 text-slate-400">{item.detail}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="border border-line bg-panel">
            <h2 className="border-b border-line px-5 py-3 text-sm font-semibold text-bone">
              Evidence desk
            </h2>
            <div className="divide-y divide-line">
              {insights.evidence.map((source) => (
                <div key={source.id} id={`evidence-${source.id}`} className="scroll-mt-8 px-5 py-3">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                    {source.publisher}
                    {source.publishedAt ? ` · ${new Date(source.publishedAt).toUTCString()}` : ""}
                  </p>
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-start gap-2 text-[13px] leading-6 text-bone hover:text-bronze-300"
                    >
                      {source.title}
                      <ArrowUpRight size={13} className="mt-1 shrink-0" />
                    </a>
                  ) : (
                    <p className="text-[13px] leading-6 text-slate-300">{source.title}</p>
                  )}
                </div>
              ))}
            </div>
            {insights.gaps.length > 0 && (
              <details className="border-t border-line px-5 py-3">
                <summary className="cursor-pointer text-xs text-slate-400">
                  Coverage & methodology · {insights.gaps.length} limitations
                </summary>
                <ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-6 text-slate-500">
                  {insights.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </>
      )}
    </>
  );
}
