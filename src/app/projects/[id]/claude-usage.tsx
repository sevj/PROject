import Link from "next/link";
import type { Messages } from "@/i18n";
import { PRICES_CHECKED_ON } from "@/lib/claude-pricing";
import { formatAge } from "@/lib/registry";
import type { ClaudeUsage } from "@/server/claude-usage/report";
import { CARD, DATA, LABEL, LINK, SECTION_TITLE } from "../../ui";

const SMALLEST_SHOWN = 0.01;

export type UsageMessages = Messages["sheet"]["claudeUsage"];

export function usageFormats(locale: string, m: UsageMessages) {
  const dollars = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" });
  const count = new Intl.NumberFormat(locale);
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const moment = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  return {
    money: (value: number) =>
      value > 0 && value < SMALLEST_SHOWN ? `< ${dollars.format(SMALLEST_SHOWN)}` : dollars.format(value),
    count: (value: number) => count.format(value),
    compact: (value: number) => compact.format(value),
    percent: (value: number) => percent.format(value),
    moment: (value: number) => moment.format(value),
    apiEquivalent: m.apiEquivalent(day.format(new Date(PRICES_CHECKED_ON))),
  };
}

/** The bars read like those of the commits: same marks, and the title gives each value. */
export function CostBars({
  values,
  label,
  titleOf,
  oldest,
  latest,
}: {
  values: number[];
  label: string;
  titleOf: (ago: number, value: number) => string;
  oldest: string;
  latest: string;
}) {
  const peak = Math.max(...values);
  return (
    <>
      <div
        className="grid h-[110px] items-end gap-x-0.5 border-b border-rule-strong"
        style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}
        role="img"
        aria-label={label}
      >
        {values.map((value, index) => (
          <div key={index} className="group flex h-full items-end" title={titleOf(values.length - 1 - index, value)}>
            <span
              className="block w-full bg-accent group-hover:bg-ink"
              style={{ height: value === 0 ? 0 : `${Math.max(3, Math.round((value / peak) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className={`${DATA} flex justify-between pt-1.5 text-mut`}>
        <span>{oldest}</span>
        <span>{latest}</span>
      </div>
    </>
  );
}

/** The summary shown on the General tab. The Claude tab has the rest. */
export function ClaudeUsageBlock({
  usage,
  projectId,
  now,
  m,
  age,
  locale,
}: {
  usage: ClaudeUsage | null;
  projectId: number;
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
  const tokenRows = [
    { label: m.inputTokens, value: usage.inputTokens },
    { label: m.outputTokens, value: usage.outputTokens },
    { label: m.cacheReadTokens, value: usage.cacheReadTokens },
    { label: m.cacheWriteTokens, value: usage.cacheWriteTokens },
  ];

  return (
    <section className={`${CARD} my-4`}>
      <div className={`${SECTION_TITLE} mb-3 flex flex-wrap justify-between gap-x-4 gap-y-1`}>
        <h2>{m.title}</h2>
        <Link href={`/projects/${projectId}?tab=claude`} scroll={false} className={LINK}>
          {m.details}
        </Link>
      </div>

      {usage.unreadableLines > 0 ? (
        <p role="alert" className={`${DATA} mb-3 text-alert`}>
          {m.unreadable(usage.unreadableLines)}
        </p>
      ) : null}

      <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="font-mono text-[28px] leading-tight tabular-nums">{format.money(usage.costInDollars)}</p>
          <p className="mb-3 text-mut">{format.apiEquivalent}</p>

          <dl>
            {tokenRows.map(({ label, value }) => (
              <div key={label} className="flex items-baseline justify-between gap-4 border-b border-rule py-1.5">
                <dt className="text-mut">{label}</dt>
                <dd className={DATA} title={format.count(value)}>
                  {format.compact(value)}
                </dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 border-b border-rule py-1.5">
              <dt className="text-mut">{m.activity}</dt>
              <dd className={DATA}>{m.sessionsAndCalls(usage.sessions.length, usage.calls)}</dd>
            </div>
            {usage.subagentCostInDollars > 0 ? (
              <div className="flex items-baseline justify-between gap-4 border-b border-rule py-1.5">
                <dt className="text-mut">{m.subagents}</dt>
                <dd className={DATA}>{format.money(usage.subagentCostInDollars)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-4 py-1.5">
              <dt className="text-mut">{m.lastActivity}</dt>
              <dd className={DATA}>{formatAge(usage.lastCallAt, now, age)}</dd>
            </div>
          </dl>
        </div>

        <div className="min-w-0">
          <h3 className={`${LABEL} mb-3.5`}>{m.weeklyCost}</h3>
          <CostBars
            values={usage.weeklyCost}
            label={m.weeklyLabel(format.money(Math.max(...usage.weeklyCost)))}
            titleOf={(weeks, cost) => m.weekTitle(weeks, format.money(cost))}
            oldest={m.weeksAgo}
            latest={m.thisWeek}
          />
        </div>
      </div>

      {usage.unpricedCalls > 0 ? (
        <p className={`${DATA} mt-3 text-mut`}>{m.unpriced(usage.unpricedCalls, usage.unpricedModels.join(", "))}</p>
      ) : null}
    </section>
  );
}
