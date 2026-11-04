import type { ReactNode } from "react";
import type { Messages } from "@/i18n";
import { formatAge } from "@/lib/registry";
import type { ClaudeUsage, UsageGroup } from "@/server/claude-usage/report";
import { CARD, DATA, LABEL, SECTION_TITLE } from "../../ui";
import { CostBars, type UsageMessages, usageFormats } from "./claude-usage";

const SESSIONS_SHOWN = 25;
const CELL = "border-b border-rule py-2 pr-4 align-top";
const NUMBER = `${CELL} ${DATA} text-right`;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** The name of a model is enough once its maker is known. */
const shortModel = (model: string) => model.replace(/^claude-/, "");

function Table({ headers, minWidth, children }: { headers: string[]; minWidth: number; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-rule-strong">
            {headers.map((title, index) => (
              <th
                key={title}
                scope="col"
                className={`${LABEL} pr-4 pb-1.5 font-normal ${index === 0 ? "" : "text-right"}`}
              >
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function ClaudeTab({
  usage,
  projectPath,
  now,
  m,
  age,
  locale,
}: {
  usage: ClaudeUsage | null;
  projectPath: string;
  now: number;
  m: UsageMessages;
  age: Messages["age"];
  locale: string;
}) {
  if (!usage) {
    return (
      <section className={`${CARD} my-4`}>
        <h2 className={`${SECTION_TITLE} mb-3`}>{m.title}</h2>
        <p className="text-mut">{m.none}</p>
      </section>
    );
  }

  const format = usageFormats(locale, m);
  const share = (cost: number) => (usage.costInDollars > 0 ? format.percent(cost / usage.costInDollars) : "—");
  // Figures this large are read in compact form, and the title has them in full.
  const Tokens = ({ value }: { value: number }) => (
    <td className={NUMBER} title={format.count(value)}>
      {format.compact(value)}
    </td>
  );
  const cost = (group: UsageGroup) => (group.calls === group.unpricedCalls ? "—" : format.money(group.costInDollars));

  const context = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const figures = [
    { label: m.last7Days, value: format.money(sum(usage.dailyCost.slice(-7))) },
    { label: m.last30Days, value: format.money(sum(usage.dailyCost)) },
    { label: m.perSession, value: format.money(usage.costInDollars / usage.sessions.length) },
    { label: m.subagents, value: format.money(usage.subagentCostInDollars) },
    { label: m.sessions, value: format.count(usage.sessions.length) },
    { label: m.calls, value: format.count(usage.calls) },
    { label: m.cacheShare, value: context > 0 ? format.percent(usage.cacheReadTokens / context) : "—" },
    { label: m.lastActivity, value: formatAge(usage.lastCallAt, now, age) },
  ];

  const kinds = [
    { label: m.inputTokens, tokens: usage.inputTokens, cost: usage.costByKind.input },
    { label: m.outputTokens, tokens: usage.outputTokens, cost: usage.costByKind.output },
    { label: m.cacheReadTokens, tokens: usage.cacheReadTokens, cost: usage.costByKind.cacheRead },
    { label: m.cacheWriteTokens, tokens: usage.cacheWriteTokens, cost: usage.costByKind.cacheWrite },
    ...(usage.webSearchRequests > 0
      ? [{ label: m.webSearches, tokens: usage.webSearchRequests, cost: usage.costByKind.webSearch }]
      : []),
  ];

  const relativeFolder = (cwd: string) =>
    cwd === projectPath ? "." : cwd.startsWith(`${projectPath}/`) ? cwd.slice(projectPath.length + 1) : cwd;

  return (
    <div className="my-4 grid gap-4">
      {usage.unreadableLines > 0 ? (
        <p role="alert" className={`${DATA} text-alert`}>
          {m.unreadable(usage.unreadableLines)}
        </p>
      ) : null}

      <section className={CARD}>
        <h2 className={`${SECTION_TITLE} mb-3`}>{m.title}</h2>
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

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <section className={CARD}>
          <h2 className={`${SECTION_TITLE} mb-3`}>{m.whereCostGoes}</h2>
          <Table headers={[m.kind, m.quantity, m.cost, m.share]} minWidth={340}>
            {kinds.map((kind) => (
              <tr key={kind.label}>
                <th scope="row" className={`${CELL} font-normal`}>
                  {kind.label}
                </th>
                <Tokens value={kind.tokens} />
                <td className={NUMBER}>{format.money(kind.cost)}</td>
                <td className={NUMBER}>{share(kind.cost)}</td>
              </tr>
            ))}
          </Table>
        </section>

        <section className={CARD}>
          <h2 className={`${SECTION_TITLE} mb-3`}>{m.byModel}</h2>
          <Table
            headers={[m.model, m.calls, m.inputTokens, m.outputTokens, m.cacheReadTokens, m.cacheWriteTokens, m.cost]}
            minWidth={620}
          >
            {usage.models.map((model) => (
              <tr key={model.model}>
                <th scope="row" className={`${CELL} ${DATA} font-normal`}>
                  {shortModel(model.model)}
                </th>
                <td className={NUMBER}>{format.count(model.calls)}</td>
                <Tokens value={model.inputTokens} />
                <Tokens value={model.outputTokens} />
                <Tokens value={model.cacheReadTokens} />
                <Tokens value={model.cacheWriteTokens} />
                <td className={NUMBER}>{cost(model)}</td>
              </tr>
            ))}
          </Table>
        </section>
      </div>

      <section className={CARD}>
        <div className={`${SECTION_TITLE} mb-3 flex flex-wrap justify-between gap-x-4 gap-y-1`}>
          <h2>{m.bySession}</h2>
          {usage.sessions.length > SESSIONS_SHOWN ? (
            <span>{m.latestSessions(SESSIONS_SHOWN, usage.sessions.length)}</span>
          ) : null}
        </div>
        <Table
          headers={[
            m.session,
            m.started,
            m.lastActivity,
            m.models,
            m.calls,
            m.outputTokens,
            m.cacheReadTokens,
            m.subagentsShort,
            m.cost,
          ]}
          minWidth={960}
        >
          {usage.sessions.slice(0, SESSIONS_SHOWN).map((session) => (
            <tr key={session.sessionId}>
              <th scope="row" className={`${CELL} ${DATA} font-normal`} title={session.sessionId}>
                {session.sessionId.slice(0, 8)}
              </th>
              <td className={NUMBER}>{format.moment(session.firstCallAt)}</td>
              <td className={NUMBER}>{formatAge(session.lastCallAt, now, age)}</td>
              <td className={NUMBER}>{session.models.map(shortModel).join(", ")}</td>
              <td className={NUMBER}>{format.count(session.calls)}</td>
              <Tokens value={session.outputTokens} />
              <Tokens value={session.cacheReadTokens} />
              <td className={NUMBER}>{session.subagentCostInDollars > 0 ? format.money(session.subagentCostInDollars) : "—"}</td>
              <td className={NUMBER}>{cost(session)}</td>
            </tr>
          ))}
        </Table>
      </section>

      {usage.folders.length > 1 ? (
        <section className={CARD}>
          <h2 className={`${SECTION_TITLE} mb-3`}>{m.byFolder}</h2>
          <Table headers={[m.folder, m.calls, m.outputTokens, m.cost, m.share]} minWidth={520}>
            {usage.folders.map((folder) => (
              <tr key={folder.cwd}>
                <th scope="row" className={`${CELL} ${DATA} font-normal break-all`} title={folder.cwd}>
                  {relativeFolder(folder.cwd)}
                </th>
                <td className={NUMBER}>{format.count(folder.calls)}</td>
                <Tokens value={folder.outputTokens} />
                <td className={NUMBER}>{cost(folder)}</td>
                <td className={NUMBER}>{share(folder.costInDollars)}</td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}
    </div>
  );
}
