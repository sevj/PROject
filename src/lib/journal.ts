/** A work journal deduced from timestamps of activity. Pure: estimates, and presented as such. */

export type JournalConfig = {
  /** Two moments of activity closer than this belong to the same stretch of work. */
  gapMinutes: number;
  /** Work is assumed to have started this long before the first moment of a stretch. */
  paddingMinutes: number;
  commits: boolean;
  claude: boolean;
  files: boolean;
};

export const DEFAULT_JOURNAL: JournalConfig = { gapMinutes: 30, paddingMinutes: 15, commits: true, claude: true, files: false };

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

/** Whatever was stored, as a complete and sane configuration. */
export function normalizeJournal(value: Partial<JournalConfig> | undefined): JournalConfig {
  return {
    gapMinutes: clamp(value?.gapMinutes, 5, 240, DEFAULT_JOURNAL.gapMinutes),
    paddingMinutes: clamp(value?.paddingMinutes, 0, 120, DEFAULT_JOURNAL.paddingMinutes),
    commits: value?.commits ?? DEFAULT_JOURNAL.commits,
    claude: value?.claude ?? DEFAULT_JOURNAL.claude,
    files: value?.files ?? DEFAULT_JOURNAL.files,
  };
}

export type Interval = { start: number; end: number };
export type Session = Interval & { moments: number };

const MINUTE = 60_000;

/** Moments of activity, in any order, grouped into stretches of work. */
export function buildSessions(moments: number[], { gapMinutes, paddingMinutes }: Pick<JournalConfig, "gapMinutes" | "paddingMinutes">): Session[] {
  const sorted = [...new Set(moments)].sort((a, b) => a - b);
  const sessions: Session[] = [];
  for (const moment of sorted) {
    const last = sessions.at(-1);
    if (last && moment - last.end <= gapMinutes * MINUTE) {
      last.end = moment;
      last.moments += 1;
    } else {
      sessions.push({ start: moment, end: moment, moments: 1 });
    }
  }
  // The padding stands for the work done before the first moment, not for what follows the last.
  return sessions.map((session) => ({ ...session, start: session.start - paddingMinutes * MINUTE }));
}

/** Overlapping stretches counted once, which is what a day of work is when projects overlap. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

/** Local midnight of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Midnight after the one starting at `dayStart`: a day is not always 24 hours. */
export function nextDay(dayStart: number): number {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/** Monday 00:00, local time, of the week containing `ms`. */
export function startOfWeek(ms: number): number {
  const day = startOfDay(ms);
  const date = new Date(day);
  const sinceMonday = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday).getTime();
}

/** Minutes of `intervals` falling in each of the seven days from `weekStart`. */
export function minutesPerDay(intervals: Interval[], weekStart: number): number[] {
  const days: number[] = [];
  let from = weekStart;
  for (let index = 0; index < 7; index += 1) {
    const to = nextDay(from);
    const ms = intervals.reduce((sum, { start, end }) => sum + Math.max(0, Math.min(end, to) - Math.max(start, from)), 0);
    days.push(Math.round(ms / MINUTE));
    from = to;
  }
  return days;
}

/** "1 h 20" or "45 min": for a cell of a table. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

export type ProjectWeek = {
  id: number;
  name: string;
  minutes: number[];
  total: number;
  sessions: Session[];
  /** Moments of activity that fell in the week, by source. */
  moments: { commits: number; claude: number; files: number };
};

export type JournalWeek = {
  weekStart: number;
  projects: ProjectWeek[];
  /** All projects together, overlaps counted once. */
  totals: number[];
  total: number;
  config: JournalConfig;
};

export function buildWeek(
  weekStart: number,
  config: JournalConfig,
  inputs: { id: number; name: string; commits: number[]; claude: number[]; files: number[] }[],
): JournalWeek {
  const weekEnd = (() => {
    let end = weekStart;
    for (let i = 0; i < 7; i += 1) end = nextDay(end);
    return end;
  })();
  const inWeek = (moment: number) => moment >= weekStart && moment < weekEnd;
  const projects: ProjectWeek[] = [];
  const everything: Interval[] = [];
  for (const input of inputs) {
    const used = [...(config.commits ? input.commits : []), ...(config.claude ? input.claude : []), ...(config.files ? input.files : [])];
    const sessions = buildSessions(used, config).filter(({ start, end }) => end >= weekStart && start < weekEnd);
    const minutes = minutesPerDay(sessions, weekStart);
    const total = minutes.reduce((sum, value) => sum + value, 0);
    if (total === 0) continue;
    everything.push(...sessions);
    projects.push({
      id: input.id,
      name: input.name,
      minutes,
      total,
      sessions,
      moments: {
        commits: config.commits ? input.commits.filter(inWeek).length : 0,
        claude: config.claude ? input.claude.filter(inWeek).length : 0,
        files: config.files ? input.files.filter(inWeek).length : 0,
      },
    });
  }
  projects.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "fr"));
  const totals = minutesPerDay(mergeIntervals(everything), weekStart);
  return { weekStart, projects, totals, total: totals.reduce((sum, value) => sum + value, 0), config };
}
