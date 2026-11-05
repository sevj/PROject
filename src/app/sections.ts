import type { Messages } from "@/i18n";

type NavLabel = Exclude<keyof Messages["nav"], "label" | "sections" | "dumpsRunning">;

export type Section = {
  label: NavLabel;
  /** The section's pages, the first one being where its menu entry leads. */
  /** `full` for a page that spans the whole window, so that its tabs line up with it. */
  pages: { href: string; label: NavLabel; wide?: boolean; full?: boolean }[];
};

/** The menu: a section with several pages shows them as tabs. */
export const SECTIONS: Section[] = [
  {
    label: "projects",
    pages: [
      { href: "/", label: "projects", full: true },
      { href: "/versions", label: "versions" },
    ],
  },
  {
    label: "databases",
    pages: [
      { href: "/databases", label: "databases" },
      { href: "/dumps", label: "dumps" },
    ],
  },
  {
    label: "docker",
    pages: [
      { href: "/docker", label: "containers" },
      { href: "/resources", label: "resources" },
      { href: "/ports", label: "ports" },
      { href: "/map", label: "map", wide: true },
    ],
  },
  {
    label: "servers",
    pages: [
      { href: "/servers", label: "servers" },
      { href: "/ssh-keys", label: "sshKeys" },
      { href: "/vpn", label: "vpn" },
    ],
  },
  { label: "journal", pages: [{ href: "/journal", label: "journal" }] },
  { label: "claude", pages: [{ href: "/claude", label: "claude" }] },
  { label: "tools", pages: [{ href: "/tools", label: "tools" }] },
  { label: "settings", pages: [{ href: "/settings", label: "settings" }] },
];

export function sectionOf(pathname: string): Section | null {
  return SECTIONS.find(({ pages }) => pages.some(({ href }) => href === pathname)) ?? null;
}
