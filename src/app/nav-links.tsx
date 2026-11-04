"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Registre" },
  { href: "/organisation", label: "Organisation" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Vues principales" className="flex self-stretch">
      {LINKS.map(({ href, label }) => (
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
