import { connection } from "next/server";
import { Suspense } from "react";
import { nextDay, startOfWeek } from "@/lib/journal";
import { getDb } from "@/server/db/client";
import { serverMessages } from "@/server/i18n";
import { readJournal } from "@/server/journal";
import { LoadingFallback } from "../loading-fallback";
import { JournalView } from "./journal-view";

function parseWeek(value: string | undefined, fallback: number): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return fallback;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? fallback : startOfWeek(date.getTime());
}

const isoDay = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

async function Journal({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await connection();
  const db = getDb();
  const { week } = await searchParams;
  const currentWeek = startOfWeek(Date.now());
  const weekStart = parseWeek(week, currentWeek);
  const journal = await readJournal(db, weekStart);

  const locale = serverMessages(db).gitTab.dateLocale;
  const days: { start: number; short: string; long: string }[] = [];
  for (let day = weekStart, index = 0; index < 7; day = nextDay(day), index += 1) {
    days.push({
      start: day,
      short: new Intl.DateTimeFormat(locale, { weekday: "short" }).format(day),
      long: new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(day),
    });
  }
  const range = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const lastDay = days[6].start;
  const previous = new Date(weekStart);
  previous.setDate(previous.getDate() - 7);
  const next = new Date(weekStart);
  next.setDate(next.getDate() + 7);

  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pt-6 pb-10">
      <JournalView
        journal={journal}
        days={days}
        rangeLabel={`${range.format(weekStart)} – ${range.format(lastDay)}`}
        previousHref={`/journal?week=${isoDay(previous.getTime())}`}
        nextHref={weekStart >= currentWeek ? null : `/journal?week=${isoDay(next.getTime())}`}
        isCurrentWeek={weekStart === currentWeek}
        locale={locale}
      />
    </main>
  );
}

export default function JournalPage(props: PageProps<"/journal">) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Journal searchParams={props.searchParams as Promise<{ week?: string }>} />
    </Suspense>
  );
}
