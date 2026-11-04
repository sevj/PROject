"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { formatMinutes, type JournalWeek } from "@/lib/journal";
import { useFlash } from "../flash";
import { BUTTON_PRIMARY, BUTTON_SMALL, CARD, DATA, FIELD, LABEL, LINK, SECTION_TITLE } from "../ui";
import { saveJournalConfig } from "./actions";

type Day = { start: number; short: string; long: string };

/** Five steps of one hue, from light to dark: the value is always written in the cell too. */
const STEPS = [12, 28, 46, 66, 86];
const intensity = (minutes: number, peak: number) => {
  if (minutes <= 0 || peak <= 0) return null;
  return Math.min(STEPS.length - 1, Math.floor((minutes / peak) * STEPS.length - 1e-9));
};
const background = (step: number) => `color-mix(in srgb, var(--accent) ${STEPS[step]}%, var(--panel))`;
const DARK_STEP = 3;

function Cell({ minutes, step, title }: { minutes: number; step: number | null; title: string }) {
  return (
    <td
      title={title}
      className={`${DATA} h-9 min-w-[64px] border border-bg px-1.5 text-center whitespace-nowrap ${step !== null && step >= DARK_STEP ? "text-bg" : ""}`}
      style={step === null ? undefined : { background: background(step) }}
    >
      {formatMinutes(minutes)}
    </td>
  );
}

function Legend() {
  const m = useMessages().journal;
  return (
    <div className="flex items-center gap-2 text-[12px] text-mut" aria-hidden="true">
      <span>{m.legendLess}</span>
      {STEPS.map((_, step) => (
        <span key={step} className="inline-block size-4" style={{ background: background(step) }} />
      ))}
      <span>{m.legendMore}</span>
    </div>
  );
}

function Settings({ config }: { config: JournalWeek["config"] }) {
  const m = useMessages().journal;
  const flash = useFlash();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(config);
  const change = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  return (
    <section className={`${CARD} grid gap-4`}>
      <h2 className={SECTION_TITLE}>{m.settings}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={`${LABEL} block pb-1`}>{m.gap}</span>
          <input type="number" min={5} max={240} value={form.gapMinutes} onChange={(event) => change({ gapMinutes: Number(event.target.value) })} className={FIELD} />
          <span className="mt-1 block text-[12px] text-mut">{m.gapHint}</span>
        </label>
        <label>
          <span className={`${LABEL} block pb-1`}>{m.padding}</span>
          <input type="number" min={0} max={120} value={form.paddingMinutes} onChange={(event) => change({ paddingMinutes: Number(event.target.value) })} className={FIELD} />
          <span className="mt-1 block text-[12px] text-mut">{m.paddingHint}</span>
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className={`${LABEL} pb-1`}>{m.sources}</legend>
        {(["commits", "claude", "files"] as const).map((source) => (
          <label key={source} className="flex items-center gap-2">
            <input type="checkbox" checked={form[source]} onChange={(event) => change({ [source]: event.target.checked })} />
            {m[source]}
          </label>
        ))}
        <p className="text-[12px] text-mut">{m.filesHint}</p>
      </fieldset>
      <div>
        <button
          type="button"
          disabled={pending}
          className={BUTTON_PRIMARY}
          onClick={() =>
            start(async () => {
              try {
                await saveJournalConfig(form);
                flash("success", m.saved);
              } catch {
                flash("error", m.saveFailed);
              }
            })
          }
        >
          {m.save}
        </button>
      </div>
    </section>
  );
}

export function JournalView({
  journal,
  days,
  rangeLabel,
  previousHref,
  nextHref,
  isCurrentWeek,
  locale,
}: {
  journal: JournalWeek;
  days: Day[];
  rangeLabel: string;
  previousHref: string;
  nextHref: string | null;
  isCurrentWeek: boolean;
  locale: string;
}) {
  const m = useMessages().journal;
  const [open, setOpen] = useState<number | null>(null);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const dayName = new Intl.DateTimeFormat(locale, { weekday: "short" });

  const peak = Math.max(0, ...journal.projects.flatMap((project) => project.minutes));
  const busiest = journal.totals.reduce((best, minutes, index) => (minutes > journal.totals[best] ? index : best), 0);
  const moments = journal.projects.reduce(
    (sum, project) => ({ commits: sum.commits + project.moments.commits, claude: sum.claude + project.moments.claude, files: sum.files + project.moments.files }),
    { commits: 0, claude: 0, files: 0 },
  );

  return (
    <div className="grid gap-5">
      <header>
        <h1 className="text-[32px] leading-none font-bold tracking-tight">{m.title}</h1>
        <p className="mt-2 max-w-2xl text-mut">{m.intro}</p>
        <p className="mt-1 max-w-2xl text-[12px] text-mut">{m.estimate}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={previousHref} scroll={false} className={BUTTON_SMALL}>
          ← {m.previousWeek}
        </Link>
        <span className="min-w-52 text-center font-medium">{rangeLabel}</span>
        {nextHref ? (
          <Link href={nextHref} scroll={false} className={BUTTON_SMALL}>
            {m.nextWeek} →
          </Link>
        ) : null}
        {isCurrentWeek ? null : (
          <Link href="/journal" scroll={false} className={BUTTON_SMALL}>
            {m.thisWeek}
          </Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className={CARD} title={m.totalHint}>
          <p className={LABEL}>{m.total}</p>
          <p className="pt-1 text-[24px] leading-tight font-bold tracking-tight">{journal.total > 0 ? formatMinutes(journal.total) : "—"}</p>
        </div>
        <div className={CARD}>
          <p className={LABEL}>{m.busiestDay}</p>
          <p className="pt-1 text-[24px] leading-tight font-bold tracking-tight">{journal.totals[busiest] > 0 ? days[busiest].long : "—"}</p>
          <p className="text-mut">{journal.totals[busiest] > 0 ? formatMinutes(journal.totals[busiest]) : ""}</p>
        </div>
        <div className={CARD}>
          <p className={LABEL}>{m.projectsCount}</p>
          <p className="pt-1 text-[24px] leading-tight font-bold tracking-tight">{journal.projects.length}</p>
        </div>
      </div>

      {journal.projects.length === 0 ? (
        <p className="text-mut">{m.nothing}</p>
      ) : (
        <section className="grid gap-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className={LABEL}>
                  <th className="px-2 py-1.5 font-normal">{m.project}</th>
                  {days.map((day) => (
                    <th key={day.start} title={day.long} className="px-1.5 py-1.5 text-center font-normal">
                      {day.short}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-right font-normal">{m.total}</th>
                </tr>
              </thead>
              <tbody>
                {journal.projects.map((project) => (
                  <Fragment key={project.id}>
                    <tr>
                      <th className="max-w-[260px] px-2 py-0 text-left font-normal">
                        <button type="button" aria-expanded={open === project.id} onClick={() => setOpen(open === project.id ? null : project.id)} className="cursor-pointer text-left hover:text-accent">
                          <span className="block truncate" title={open === project.id ? m.hideSessions : m.showSessions}>
                            {project.name}
                          </span>
                        </button>
                      </th>
                      {project.minutes.map((minutes, index) => (
                        <Cell key={days[index].start} minutes={minutes} step={intensity(minutes, peak)} title={m.cell(project.name, days[index].long, formatMinutes(minutes) || "0")} />
                      ))}
                      <td className={`${DATA} px-2 text-right font-medium`}>{formatMinutes(project.total)}</td>
                    </tr>
                    {open === project.id ? (
                      <tr>
                        <td colSpan={9} className="px-2 pt-1 pb-3">
                          <p className={`${LABEL} pb-1`}>{m.sessions}</p>
                          <ul className="grid gap-0.5">
                            {project.sessions.map((session) => (
                              <li key={session.start} className={DATA}>
                                {m.sessionLine(dayName.format(session.start), time.format(session.start), time.format(session.end), session.moments)}
                              </li>
                            ))}
                          </ul>
                          <p className="pt-1">
                            <Link href={`/projects/${project.id}`} className={LINK}>
                              {project.name}
                            </Link>
                          </p>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-rule-strong">
                  <th className="px-2 py-1.5 text-left font-medium">{m.allProjects}</th>
                  {journal.totals.map((minutes, index) => (
                    <td key={days[index].start} className={`${DATA} px-1.5 py-1.5 text-center font-medium`} title={m.cell(m.allProjects, days[index].long, formatMinutes(minutes) || "0")}>
                      {formatMinutes(minutes)}
                    </td>
                  ))}
                  <td className={`${DATA} px-2 py-1.5 text-right font-medium`}>{formatMinutes(journal.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Legend />
            <p className="text-[12px] text-mut">{m.sourcesLine(moments.commits, moments.claude, moments.files)}</p>
          </div>
        </section>
      )}

      <Settings key={`${journal.config.gapMinutes}-${journal.config.paddingMinutes}-${journal.config.commits}-${journal.config.claude}-${journal.config.files}`} config={journal.config} />
    </div>
  );
}
