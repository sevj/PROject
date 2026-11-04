import { posix } from "node:path";

export function isMarkdown(file: string): boolean {
  return /\.(md|markdown)$/i.test(file);
}

/** Front matter is metadata for tools, not part of what the document says. */
export function stripFrontMatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
}

export type DocLink =
  | { kind: "external"; href: string }
  | { kind: "anchor"; href: string }
  | { kind: "document"; file: string; hash: string }
  /** Points at a file of the project that the app does not show. */
  | { kind: "none" };

/** `from` is the document holding the link, both being relative to the project root. */
export function resolveDocLink(href: string | undefined, from: string, docs: string[]): DocLink {
  if (!href) return { kind: "none" };
  if (href.startsWith("#")) return { kind: "anchor", href };
  if (/^(https?:|mailto:)/i.test(href)) return { kind: "external", href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) return { kind: "none" };
  const [path, hash = ""] = href.split("#");
  const file = posix.normalize(posix.join(posix.dirname(from), path));
  return docs.includes(file) ? { kind: "document", file, hash } : { kind: "none" };
}
