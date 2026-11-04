"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMessages } from "@/i18n/provider";

export function NavLinks() {
  const pathname = usePathname();
  const m = useMessages().nav;
  const links = [
    { href: "/", label: m.projects },
    { href: "/board", label: m.board },
    { href: "/settings", label: m.settings },
  ];
  return (
    <nav aria-label={m.label} className="flex self-stretch">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className="-mb-px inline-flex items-center border-b-[3px] border-transparent px-3.5 font-medium text-mut hover:text-ink aria-[current=page]:border-ink aria-[current=page]:text-ink"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
