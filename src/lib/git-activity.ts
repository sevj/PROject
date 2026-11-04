const WEEK_MS = 7 * 24 * 3600 * 1000;

export type WeekLabel = {
  /** "28 oct. – 4 nov." */
  range: string;
  /** The month that starts during this week, if any. */
  month: string | null;
};

/** Oldest week first. Weeks are counted back from now, like the commits they label. */
export function weekLabels(now: number, count: number, locale: string, timeZone?: string): WeekLabel[] {
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone });
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone });
  const year = new Intl.DateTimeFormat(locale, { year: "numeric", timeZone });
  const monthNumber = new Intl.DateTimeFormat("en", { month: "numeric", timeZone });

  return Array.from({ length: count }, (_, index) => {
    const start = new Date(now - (count - index) * WEEK_MS);
    const end = new Date(now - (count - 1 - index) * WEEK_MS);
    const startMonth = monthNumber.format(start);
    const endMonth = monthNumber.format(end);
    return {
      range: `${day.format(start)} – ${day.format(end)}`,
      month: startMonth === endMonth ? null : endMonth === "1" ? year.format(end) : month.format(end),
    };
  });
}

/** The nearest 1, 2 or 5 × 10ⁿ at or above the value, so that an axis has round numbers. */
export function niceCeiling(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** From the ceiling down to zero; the middle only when it is a whole number of commits. */
export function axisTicks(ceiling: number): number[] {
  return ceiling % 2 === 0 ? [ceiling, ceiling / 2, 0] : [ceiling, 0];
}

export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
