import { StatusBadge } from "@sisera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "../../../../auth";
import { AgentCreateForm } from "../../../../components/agent-create-form";
import { AgentReadiness } from "../../../../components/agent-readiness";
import { AgentResearch } from "../../../../components/agent-research";
import { PageHeader } from "../../../../components/page-header";
import { StageTrack } from "../../../../components/platform/ui";
import { accountErrorMessage, getAgents } from "../../../../lib/api";

export const metadata: Metadata = {
  title: "Superbots",
  description: "Draft rule-bound Superbots with capital caps, drawdown limits, and a kill switch.",
};

export const dynamic = "force-dynamic";

const stages = ["Draft", "Backtest", "Stress", "Paper", "Shadow", "Limited live", "Live"];

export default async function AgentsPage({
  searchParams,
}: { searchParams: Promise<{ template?: string }> }) {
  const { template: templateId } = await searchParams;
  const session = await auth();
  const result = await getAgents({
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  }).then(
    (value) => ({ value, error: null as unknown }),
    (error: unknown) => ({ value: null, error }),
  );
  const agents = result.value;
  const templates = [...(agents?.templates ?? [])].sort((a, b) =>
    a.id === "private-market-value-v1" ? -1 : b.id === "private-market-value-v1" ? 1 : 0,
  );
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
  const account = Boolean(
    session &&
      !session.accessToken.startsWith("guest:") &&
      !session.accessToken.startsWith("wallet:"),
  );
  return (
    <div>
      <PageHeader
        eyebrow="Trading strategies"
        title="Superbots"
        description="Turn strategies into Superbots: executable rules, a 5-year backtest, stress tests, paper and shadow trading, then limited live capital — every step recorded as evidence."
        actions={
          <StatusBadge tone="neutral">{agents?.custom.length ?? 0} saved strategies</StatusBadge>
        }
      />
      <div className="overflow-x-auto border-b border-line bg-panel px-4 py-5">
        <div className="flex min-w-[760px] items-center">
          {stages.map((stage, index) => (
            <div key={stage} className="flex flex-1 items-start">
              <div className="flex min-w-24 flex-col items-center">
                <span className="size-2 border border-line-strong bg-slate-900" />
                <span className="mt-2 text-[10px] text-slate-500">{stage}</span>
              </div>
              {index < stages.length - 1 && <span className="mt-1 h-px flex-1 bg-line" />}
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-[1.4fr_.6fr]">
        <div className="space-y-4">
          {result.error !== null && (
            <p className="border border-amber-400/30 p-3 text-xs text-amber-200">
              {accountErrorMessage(result.error)}
            </p>
          )}
          {agents?.persistence === "unavailable" && (
            <p className="border border-amber-400/30 p-3 text-xs text-amber-200">
              Your saved strategies are reconnecting. You can still explore the ideas below.
            </p>
          )}
          <section className="border border-line bg-panel">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
              Strategy templates
            </h2>
            <div className="grid gap-3 p-3 md:grid-cols-2">
              {templates.map((agent) => (
                <article key={agent.id} className="border border-line bg-ink p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-white">{agent.name}</h3>
                    <StatusBadge tone="neutral">Research</StatusBadge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{agent.description}</p>
                  <p className="mt-3 font-mono text-[10px] text-bronze-300">
                    {agent.universe.join(" · ")} · {agent.timeframe}
                  </p>
                  <ul className="mt-3 list-inside list-disc space-y-1 text-[11px] text-slate-400">
                    {agent.factors.map((factor) => (
                      <li key={factor}>{factor}</li>
                    ))}
                  </ul>
                  <p className="mt-3 border-t border-line pt-3 text-[10px] leading-5 text-amber-200/80">
                    {agent.risk}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Link
                      href={`/agents?template=${encodeURIComponent(agent.id)}#builder`}
                      className="bg-bronze-300 px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-bronze-200"
                    >
                      Customize this template
                    </Link>
                  </div>
                  <AgentResearch id={agent.id} />
                </article>
              ))}
              {!agents && (
                <p className="p-4 text-xs text-amber-300">
                  Strategy ideas are reconnecting. Explore markets and research in the meantime.
                </p>
              )}
            </div>
          </section>
          <section className="border border-line bg-panel">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
              Your strategies
            </h2>
            {agents?.persistence === "unavailable" ? (
              <p className="p-5 text-xs text-amber-200">
                Saved strategies will reappear when your account reconnects.
              </p>
            ) : agents?.custom.length ? (
              <div className="divide-y divide-line">
                {agents.custom.map((agent) => (
                  <article key={agent.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/agents/${encodeURIComponent(agent.id)}`}
                        className="text-xs font-semibold text-white hover:text-bronze-200"
                      >
                        {agent.name}{" "}
                        <span className="font-mono text-[10px] text-slate-500">
                          v{agent.version}
                        </span>
                      </Link>
                      <div className="flex items-center gap-2">
                        <StageTrack stage={agent.stage} />
                        <StatusBadge
                          tone={
                            agent.stage === "paused"
                              ? "negative"
                              : agent.stage === "live" || agent.stage === "limited_live"
                                ? "positive"
                                : "warning"
                          }
                        >
                          {agent.stage.replace("_", " ")}
                        </StatusBadge>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{agent.policy.description}</p>
                    <p className="mt-2 font-mono text-[10px] text-slate-500">
                      {agent.policy.universe?.join(" · ")} · {agent.policy.timeframe} · autonomy{" "}
                      {agent.autonomy.replace("_", " ")}
                      {agent.hasRules ? " · executable rules" : " · no rules yet"}
                    </p>
                    {agent.policy.capitalAllocation && (
                      <p className="mt-1 text-[10px] text-slate-400">
                        Capital cap ${agent.policy.capitalAllocation.maxCapitalUsd.toLocaleString()}{" "}
                        · Trade cap $
                        {agent.policy.capitalAllocation.maxTradeNotionalUsd.toLocaleString()}
                        {agent.policy.riskGuardrails &&
                          ` · Daily drawdown ${agent.policy.riskGuardrails.maxDailyDrawdownPct}%`}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <Link
                        href={`/agents/${encodeURIComponent(agent.id)}`}
                        className="text-[11px] font-semibold text-bronze-200 hover:underline"
                      >
                        Open pipeline →
                      </Link>
                    </div>
                    <AgentReadiness id={agent.id} />
                  </article>
                ))}
              </div>
            ) : (
              <p className="p-5 text-xs text-slate-400">
                Start with a strategy above, then save your own idea with the builder alongside it.
              </p>
            )}
          </section>
        </div>
        <AgentCreateForm
          key={selectedTemplate?.id ?? "blank"}
          enabled={account && agents?.persistence === "postgres"}
          template={selectedTemplate}
        />
      </div>
    </div>
  );
}
