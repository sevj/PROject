import { type BundledLanguage, bundledLanguages, getSingletonHighlighter } from "shiki";

/** Text, then its color in the light theme and in the dark one. */
export type CodeToken = [text: string, light: string, dark: string];

/** Beyond this, the file is shown plain: coloring it would take longer than reading it. */
const MAX_HIGHLIGHT_BYTES = 300 * 1024;
const THEMES = { light: "github-light", dark: "github-dark" } as const;

const BY_NAME: Record<string, BundledLanguage> = {
  dockerfile: "dockerfile",
  makefile: "make",
  "composer.lock": "json",
  ".gitignore": "shellscript",
  ".dockerignore": "shellscript",
  ".htaccess": "apache",
};

/** From the name of the file: `phpunit.xml.dist` reads as XML, `Dockerfile.prod` as a Dockerfile. */
export function languageOf(path: string): BundledLanguage | null {
  const name = (path.split("/").pop() ?? "").toLowerCase().replace(/\.(dist|example|sample|tpl)$/, "");
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith("dockerfile")) return "dockerfile";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return extension in bundledLanguages ? (extension as BundledLanguage) : null;
}

/** One list of tokens per line. Null when the language is unknown or the file too large. */
export async function highlightSource(path: string, content: string): Promise<CodeToken[][] | null> {
  const lang = languageOf(path);
  if (!lang || Buffer.byteLength(content) > MAX_HIGHLIGHT_BYTES) return null;
  try {
    const highlighter = await getSingletonHighlighter({ themes: Object.values(THEMES), langs: [] });
    await highlighter.loadLanguage(lang);
    const { tokens } = highlighter.codeToTokens(content.replace(/\n$/, ""), {
      lang,
      themes: THEMES,
      defaultColor: false,
      // A minified line would hold everything up: past this length it stays plain.
      tokenizeMaxLineLength: 2000,
    });
    return tokens.map((line) =>
      line.map(({ content: text, htmlStyle }) => {
        const style = (htmlStyle ?? {}) as Record<string, string>;
        return [text, style["--shiki-light"] ?? "", style["--shiki-dark"] ?? ""];
      }),
    );
  } catch {
    return null;
  }
}
