import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatAge } from "@/lib/registry";
import { readGlobalClaudeUsage } from "@/server/claude-usage/report";
import { getDb } from "@/server/db/client";
import { serverMessages } from "@/server/i18n";
import { LoadingFallback } from "../loading-fallback";
import { CELL, NUMBER, Table } from "../projects/[id]/claude-tab";
import { CostBars, usageFormats } from "../projects/[id]/claude-usage";
import { CARD, DATA, LINK, SECTION_TITLE, PAGE_TITLE } from "../ui";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const shortModel = (model: string) => model.replace(/^claude-/, "");

async function readOverview() {
  await connection();
  const now = Date.now();
  return { now, usage: readGlobalClaudeUsage(getDb(), now) };
}

async function ClaudeOverview() {
  const { now, usage } = await readOverview();
  const messages = serverMessages(getDb());
  const m = messages.sheet.claudeUsage;
  const global = messages.sheet.claudeGlobal;
  const heading = <h1 className={PAGE_TITLE}>{global.title}</h1>;
  const page = "mx-auto grid w-full max-w-[1240px] flex-1 content-start gap-4 px-5 pt-6 pb-10";
  if (!usage) {
    return (
      <main className={page}>
        {heading}
        <p className="text-mut">{global.none}</p>
      </main>
    );
  }

  const format = usageFormats(messages.gitTab.dateLocale, m);
  const share = (cost: number) => (usage.costInDollars > 0 ? format.percent(cost / usage.costInDollars) : "—");
  const figures = [
    { label: global.last7Days, value: format.money(sum(usage.dailyCost.slice(-7))) },
    { label: global.last30Days, value: format.money(sum(usage.dailyCost)) },
    { label: m.subagents, value: format.money(usage.subagentCostInDollars) },
    { label: global.projects, value: format.count(usage.projects.filter(({ projectId }) => projectId !== null).length) },
    { label: m.sessions, value: format.count(usage.sessions.length) },
    { label: m.calls, value: format.count(usage.calls) },
    { label: m.lastActivity, value: formatAge(usage.lastCallAt, now, messages.age) },
  ];

  return (
    <main className={page}>
      {heading}
      {usage.unreadableLines > 0 ? (
        <p role="alert" className={`${DATA} text-alert`}>
          {m.unreadable(usage.unreadableLines)}
        </p>
      ) : null}

      <section className={CARD}>
        <p className="font-mono text-[28px] leading-tight tabular-nums">{format.money(usage.costInDollars)}</p>
        <p className="mb-4 text-mut">{format.apiEquivalent}</p>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-4">
          {figures.map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="text-mut">{label}</dt>
              <dd className={DATA}>{value}</dd>
            </div>
          ))}
        </dl>
        {usage.unpricedCalls > 0 ? (
          <p className={`${DATA} mt-3 text-mut`}>{m.unpriced(usage.unpricedCalls, usage.unpricedModels.join(", "))}</p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={CARD}>
          <h2 className={`${SECTION_TITLE} mb-3.5`}>{m.dailyCost}</h2>
          <CostBars
            values={usage.dailyCost}
            label={m.dailyLabel(format.money(Math.max(...usage.dailyCost)))}
            titleOf={(days, value) => m.dayTitle(days, format.money(value))}
            oldest={m.daysAgo}
            latest={m.today}
          />
        </section>
        <section className={CARD}>
          <h2 className={`${SECTION_TITLE} mb-3.5`}>{m.weeklyCost}</h2>
          <CostBars
            values={usage.weeklyCost}
            label={m.weeklyLabel(format.money(Math.max(...usage.weeklyCost)))}
            titleOf={(weeks, value) => m.weekTitle(weeks, format.money(value))}
            oldest={m.weeksAgo}
            latest={m.thisWeek}
          />
        </section>
      </div>

      <section className={CARD}>
        <h2 className={`${SECTION_TITLE} mb-3`}>{global.byProject}</h2>
        <Table headers={[global.project, m.sessions, m.calls, m.lastActivity, m.cost, m.share]} minWidth={640}>
          {usage.projects.map((project) => (
            <tr key={String(project.projectId)}>
              <th scope="row" className={`${CELL} font-normal`}>
                {project.projectId !== null && project.name ? (
                  <Link href={`/projects/${project.projectId}?tab=claude`} className={LINK}>
                    {project.name}
                  </Link>
                ) : (
                  <span className="text-mut">{project.name ?? global.outside}</span>
                )}
              </th>
              <td className={NUMBER}>{format.count(project.sessions)}</td>
              <td className={NUMBER}>{format.count(project.calls)}</td>
              <td className={NUMBER}>{formatAge(project.lastCallAt, now, messages.age)}</td>
              <td className={NUMBER}>{format.money(project.costInDollars)}</td>
              <td className={NUMBER}>{share(project.costInDollars)}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section className={CARD}>
        <h2 className={`${SECTION_TITLE} mb-3`}>{m.byModel}</h2>
        <Table headers={[m.model, m.calls, m.outputTokens, m.cacheReadTokens, m.cost, m.share]} minWidth={560}>
          {usage.models.map((model) => (
            <tr key={model.model}>
              <th scope="row" className={`${CELL} ${DATA} font-normal`}>
                {shortModel(model.model)}
              </th>
              <td className={NUMBER}>{format.count(model.calls)}</td>
              <td className={NUMBER} title={format.count(model.outputTokens)}>
                {format.compact(model.outputTokens)}
              </td>
              <td className={NUMBER} title={format.count(model.cacheReadTokens)}>
                {format.compact(model.cacheReadTokens)}
              </td>
              <td className={NUMBER}>{format.money(model.costInDollars)}</td>
              <td className={NUMBER}>{share(model.costInDollars)}</td>
            </tr>
          ))}
        </Table>
      </section>
    </main>
  );
}

export default function ClaudePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ClaudeOverview />
    </Suspense>
  );
}
