/** Accents and case aside: "éte" finds "Été". */
export const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * How well `query` matches `text`, its letters in order but not side by side ("villrec" finds
 * "Villette · recette"); null when it does not. Higher is better: letters that follow one
 * another, that start a word, or a match from the very start count more.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = fold(query).replace(/\s+/g, "");
  if (!needle) return 0;
  const haystack = fold(text);
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of needle) {
    const at = haystack.indexOf(char, from);
    if (at < 0) return null;
    score += 1;
    if (at === previous + 1) score += 3;
    if (at === 0 || /[\s·/_.:-]/.test(haystack[at - 1])) score += 2;
    previous = at;
    from = at + 1;
  }
  if (haystack.startsWith(needle)) score += 5;
  else if (haystack.includes(needle)) score += 3;
  // Among equals, the shorter text is the closer one.
  return score - haystack.length / 100;
}

export type Searchable = { id: string; title: string; subtitle?: string; keywords?: string };

/** The best first; the title counts more than what is said below it. */
export function rank<T extends Searchable>(items: T[], query: string, recent: string[] = []): T[] {
  if (!query.trim()) {
    const position = (item: T) => {
      const index = recent.indexOf(item.id);
      return index < 0 ? recent.length : index;
    };
    return [...items].sort((a, b) => position(a) - position(b));
  }
  return items
    .flatMap((item) => {
      const byTitle = fuzzyScore(query, item.title);
      const byRest = fuzzyScore(query, [item.title, item.subtitle, item.keywords].filter(Boolean).join(" "));
      const score = Math.max(byTitle === null ? -Infinity : byTitle * 2, byRest ?? -Infinity);
      if (score === -Infinity) return [];
      // A recent one wins a tie.
      return [{ item, score: score + (recent.includes(item.id) ? 1 : 0) }];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

export const RECENT_LIMIT = 8;

/** The one just used first, without doubles. */
export const remember = (recent: string[], id: string) => [id, ...recent.filter((item) => item !== id)].slice(0, RECENT_LIMIT);
