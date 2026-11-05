"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMessages } from "@/i18n/provider";
import { DumpsBadge } from "./nav-links";
import { sectionOf } from "./sections";
import { TAB } from "./ui";

/** The pages of the open section, above whichever of them is shown. */
export function SectionTabs() {
  const pathname = usePathname();
  const m = useMessages().nav;
  const section = sectionOf(pathname);
  if (!section || section.pages.length < 2) return null;
  const wide = section.pages.find(({ href }) => href === pathname)?.wide;
  return (
    <div className={`mx-auto w-full px-5 pt-4 ${wide ? "max-w-[1500px]" : "max-w-[1240px]"}`}>
      <nav aria-label={m.sections} className="flex flex-wrap border-b border-rule-strong">
        {section.pages.map(({ href, label }) => (
          <Link key={href} href={href} aria-current={href === pathname ? "page" : undefined} className={TAB}>
            {m[label]}
            {href === "/dumps" ? <DumpsBadge /> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function SectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionTabs />
      {children}
    </>
  );
}
