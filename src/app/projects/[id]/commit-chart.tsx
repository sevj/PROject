"use client";

import { type KeyboardEvent, Suspense, use, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { axisTicks, niceCeiling, sum, type WeekLabel } from "@/lib/git-activity";
import type { AuthorCommits, AuthorHistory } from "@/server/scan/git";
import { DATA, LABEL, SECTION_TITLE, SEGMENT } from "../../ui";

const PERIODS = [13, 26, 52] as const;
type Period = (typeof PERIODS)[number];

const seriesColor = (index: number, author: AuthorCommits) =>
  author.name === null ? "var(--series-other)" : `var(--series-${index + 1})`;

type LinesSource = { lines: Promise<AuthorHistory[]>; name: string | null };

/** Added or removed lines of an author over the last weeks, as soon as they are known. */
function LineTotal({ lines, name, period, kind }: LinesSource & { period: Period; kind: "insertions" | "deletions" }) {
  const { dateLocale } = useMessages().gitTab;
  const author = use(lines).find((item) => item.name === name);
  if (!author) return "—";
  return `${kind === "insertions" ? "+" : "−"}${sum(author[kind].slice(-period)).toLocaleString(dateLocale)}`;
}

/** `week` counts back from the current week, which does not depend on the period shown. */
function WeekLines({ lines, name, week }: LinesSource & { week: number }) {
  const author = use(lines).find((item) => item.name === name);
  if (!author) return null;
  const added = author.insertions.at(-1 - week) ?? 0;
  const removed = author.deletions.at(-1 - week) ?? 0;
  if (added + removed === 0) return null;
  return (
    <span className={`${DATA} col-start-3 text-mut`}>
      +{added} −{removed}
    </span>
  );
}

const PENDING = <span className="text-rule-strong">…</span>;

/** Up to 52 weeks are known by the client: changing the period does not read anything again. */
export function CommitChart({
  authors,
  lines,
  labels,
}: {
  authors: AuthorCommits[];
  lines: Promise<AuthorHistory[]>;
  labels: WeekLabel[];
}) {
  const messages = useMessages();
  const m = messages.gitTab;
  const [period, setPeriod] = useState<Period>(26);
  const [activeWeek, setActiveWeek] = useState<number | null>(null);
  const [activeAuthor, setActiveAuthor] = useState<number | null>(null);

  const authorName = (author: AuthorCommits) => author.name ?? m.otherAuthors(author.people);
  // Each author keeps their index, thus their color, whatever the period shows.
  const series = authors.map((author, index) => ({
    author,
    index,
    commits: author.commits.slice(-period),
  }));
  const weeks = labels.slice(-period);
  const totals = weeks.map((_, week) => sum(series.map(({ commits }) => commits[week])));
  const total = sum(totals);
  const peak = Math.max(...totals, 0);
  const ceiling = niceCeiling(peak);
  const ranked = series
    .map((item) => ({ ...item, count: sum(item.commits) }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count);

  const weekDescription = (week: number) =>
    `${weeks[week].range} : ${m.commitCount(totals[week])}${series
      .filter(({ commits }) => commits[week] > 0)
      .map(({ author, commits }) => `, ${authorName(author)} ${commits[week]}`)
      .join("")}`;

  function onKeyDown(event: KeyboardEvent) {
    const last = weeks.length - 1;
    const current = activeWeek ?? last;
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, current - 1)
        : event.key === "ArrowRight"
          ? Math.min(last, current + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActiveWeek(next);
  }

  const shown = activeWeek === null || activeWeek >= weeks.length ? null : activeWeek;

  return (
    <>
      <h2 className={SECTION_TITLE}>{m.commitsByAuthor}</h2>
      <div className="mt-2.5 mb-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className={`${DATA} text-mut`}>{m.summary(total, peak, Math.round((total / period) * 10) / 10)}</p>
        </div>
        <div role="group" aria-label={m.period} className="flex">
          {PERIODS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={period === item}
              onClick={() => {
                setPeriod(item);
                setActiveWeek(null);
              }}
              className={`${SEGMENT} ${DATA} min-h-8!`}
            >
              {m.periodWeeks(item)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div className={`${DATA} relative h-[220px] w-7 text-right text-mut`} aria-hidden="true">
          {axisTicks(ceiling).map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (tick / ceiling) * 100}%` }}>
              {tick}
            </span>
          ))}
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-label={m.commitsByAuthor}
          aria-valuemin={0}
          aria-valuemax={weeks.length - 1}
          aria-valuenow={shown ?? weeks.length - 1}
          aria-valuetext={weekDescription(shown ?? weeks.length - 1)}
          onKeyDown={onKeyDown}
          onFocus={() => setActiveWeek((week) => week ?? weeks.length - 1)}
          onBlur={() => setActiveWeek(null)}
          onPointerLeave={() => setActiveWeek(null)}
          className="relative h-[220px] border-b border-rule-strong"
        >
          {axisTicks(ceiling)
            .filter((tick) => tick > 0)
            .map((tick) => (
              <span
                key={tick}
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-rule"
                style={{ top: `${100 - (tick / ceiling) * 100}%` }}
              />
            ))}

          <div className="absolute inset-0 flex gap-x-0.5">
            {weeks.map((_, week) => (
              <div
                key={week}
                onPointerEnter={() => setActiveWeek(week)}
                className={`flex h-full min-w-0 flex-1 flex-col justify-end ${shown === week ? "bg-sel" : ""}`}
              >
                <div
                  className="flex flex-col-reverse gap-y-0.5"
                  style={{ height: `${(totals[week] / ceiling) * 100}%` }}
                >
                  {series.map(({ author, index, commits }) =>
                    commits[week] > 0 ? (
                      <span
                        key={index}
                        className="min-h-0.5 transition-opacity"
                        style={{
                          flex: `${commits[week]} 1 0`,
                          background: seriesColor(index, author),
                          opacity: activeAuthor === null || activeAuthor === index ? 1 : 0.2,
                        }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </div>

          {shown !== null ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-10 w-[220px] border border-rule-strong bg-panel p-2.5"
              style={
                shown < weeks.length / 2
                  ? { left: `calc(${((shown + 1) / weeks.length) * 100}% + 6px)` }
                  : { right: `calc(${((weeks.length - shown) / weeks.length) * 100}% + 6px)` }
              }
            >
              <div className={`${DATA} text-mut`}>{weeks[shown].range}</div>
              <div className="mb-1.5 font-semibold">{m.commitCount(totals[shown])}</div>
              {series
                .filter(({ commits }) => commits[shown] > 0)
                .sort((a, b) => b.commits[shown] - a.commits[shown])
                .map(({ author, index, commits }) => (
                  <div key={index} className="grid grid-cols-[10px_auto_minmax(0,1fr)] items-center gap-x-1.5 py-0.5">
                    <span className="h-0.5 w-2.5" style={{ background: seriesColor(index, author) }} />
                    <span className={`${DATA} font-medium`}>{commits[shown]}</span>
                    <span className="truncate text-mut">{authorName(author)}</span>
                    <Suspense fallback={null}>
                      <WeekLines lines={lines} name={author.name} week={weeks.length - 1 - shown} />
                    </Suspense>
                  </div>
                ))}
            </div>
          ) : null}
        </div>

        <div className={`${DATA} relative col-start-2 h-6 text-mut`} aria-hidden="true">
          {weeks.map(({ month }, week) => {
            if (month === null) return null;
            const nth = weeks.slice(0, week + 1).filter((item) => item.month !== null).length;
            return (
              <span
                key={week}
                // A full year has no room for every month on a phone.
                className={`absolute top-1.5 whitespace-nowrap ${period === 52 && nth % 2 === 0 ? "max-sm:hidden" : ""}`}
                style={{ left: `${(week / weeks.length) * 100}%` }}
              >
                {month}
              </span>
            );
          })}
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="mt-4 text-mut">{m.noCommitInPeriod}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className={`${LABEL} border-b border-rule-strong text-left`}>
                <th scope="col" className="py-1.5 pr-3 font-normal">{m.author}</th>
                <th scope="col" className="py-1.5 pl-3 text-right font-normal">{m.commits}</th>
                <th scope="col" className="py-1.5 pl-3 text-right font-normal">{m.share}</th>
                <th scope="col" className="py-1.5 pl-3 text-right font-normal">{m.linesAdded}</th>
                <th scope="col" className="py-1.5 pl-3 text-right font-normal">{m.linesRemoved}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ author, index, count }) => (
                <tr
                  key={index}
                  onPointerEnter={() => setActiveAuthor(index)}
                  onPointerLeave={() => setActiveAuthor(null)}
                  className="border-b border-rule last:border-b-0 hover:bg-sel"
                >
                  <td className="max-w-[260px] py-[7px] pr-3">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="size-2.5 shrink-0" style={{ background: seriesColor(index, author) }} />
                      <span className="truncate">{authorName(author)}</span>
                    </span>
                  </td>
                  <td className={`${DATA} pl-3 text-right`}>{count}</td>
                  <td className={`${DATA} pl-3 text-right text-mut`}>{Math.round((count / total) * 100)} %</td>
                  <td className={`${DATA} pl-3 text-right text-mut`}>
                    <Suspense fallback={PENDING}>
                      <LineTotal lines={lines} name={author.name} period={period} kind="insertions" />
                    </Suspense>
                  </td>
                  <td className={`${DATA} pl-3 text-right text-mut`}>
                    <Suspense fallback={PENDING}>
                      <LineTotal lines={lines} name={author.name} period={period} kind="deletions" />
                    </Suspense>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
