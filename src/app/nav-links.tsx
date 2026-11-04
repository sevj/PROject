"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMessages } from "@/i18n/provider";

export function NavLinks() {
  const pathname = usePathname();
  const m = useMessages().nav;
  const links = [
    { href: "/", label: m.projects },
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
        </Link>
      ))}
    </nav>
  );
}
