"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMessages } from "@/i18n/provider";
import { overallPercent } from "@/lib/dumps";
import { useDumpActivity } from "./dump-activity";

export function NavLinks() {
  const pathname = usePathname();
  const m = useMessages().nav;
  const running = useDumpActivity()?.jobs.filter((job) => job.status === "running") ?? [];
  const percent = overallPercent(running);
  const links = [
    { href: "/", label: m.projects },
    { href: "/dumps", label: m.dumps },
    { href: "/resources", label: m.resources },
    { href: "/ports", label: m.ports },
    { href: "/databases", label: m.databases },
    { href: "/journal", label: m.journal },
    { href: "/map", label: m.map },
    { href: "/settings", label: m.settings },
  ];
  return (
    <nav aria-label={m.label} className="flex self-stretch border-l border-rule pl-3">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className="-mb-px inline-flex items-center border-b-2 border-transparent px-3 font-mono text-[12px] tracking-[.06em] text-mut hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink"
        >
          {label}
          {href === "/dumps" && running.length > 0 ? (
            <span
              role="status"
              aria-label={m.dumpsRunning(running.length)}
              title={m.dumpsRunning(running.length)}
              className="ml-2 inline-flex items-center gap-1 bg-accent px-1.5 py-0.5 text-[11px] leading-none font-medium text-bg"
            >
              {running.length}
              {percent === null ? null : ` · ${percent}%`}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
