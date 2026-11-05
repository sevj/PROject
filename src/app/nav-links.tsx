"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMessages } from "@/i18n/provider";
import { overallPercent } from "@/lib/dumps";
import { useDumpActivity } from "./dump-activity";
import { type Section, SECTIONS, sectionOf } from "./sections";

/** Dumps and loads in progress, shown wherever the dump stash can be reached. */
export function DumpsBadge() {
  const m = useMessages().nav;
  const running = useDumpActivity()?.jobs.filter((job) => job.status === "running") ?? [];
  if (running.length === 0) return null;
  const percent = overallPercent(running);
  return (
    <span
      role="status"
      aria-label={m.dumpsRunning(running.length)}
      title={m.dumpsRunning(running.length)}
      className="ml-2 inline-flex items-center gap-1 bg-accent px-1.5 py-0.5 text-[11px] leading-none font-medium text-bg"
    >
      {running.length}
      {percent === null ? null : ` · ${percent}%`}
    </span>
  );
}

function hasDumps(section: Section): boolean {
  return section.pages.some(({ href }) => href === "/dumps");
}

export function NavLinks() {
  const pathname = usePathname();
  const m = useMessages().nav;
  const current = sectionOf(pathname);
  return (
    <nav aria-label={m.label} className="flex self-stretch border-l border-rule pl-3">
      {SECTIONS.map((section) => (
        <Link
          key={section.label}
          href={section.pages[0].href}
          aria-current={section === current ? "page" : undefined}
          className="-mb-px inline-flex items-center border-b-2 border-transparent px-3 text-[14px] font-medium text-mut hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink"
        >
          {m[section.label]}
          {hasDumps(section) ? <DumpsBadge /> : null}
        </Link>
      ))}
    </nav>
  );
}
