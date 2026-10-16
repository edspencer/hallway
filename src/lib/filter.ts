// The filter (docs/05-ui.md, "Keyboard"): fuzzy over name, slug, host, port, directory, branch and bookmark titles.
// Every word of the query must match some field as a substring, or the name as an abbreviation (a subsequence that
// starts a word: `lgv` finds "Log viewer"; `log` doesn't find "runbooks.example.org"). Pure (tested under node).

/** The text an item can be found by. */
export interface Findable {
  /** Strongest first: a match on the first field outranks one on the rest. */
  fields: (string | number | null | undefined)[];
}

/** Is `needle` a subsequence of `hay` that begins at the start of one of its words? */
function abbreviates(needle: string, hay: string): boolean {
  for (let start = 0; start < hay.length; start++) {
    if (hay[start] !== needle[0] || (start > 0 && /[\p{L}\p{N}]/u.test(hay[start - 1]!))) continue;
    let i = 1;
    for (let j = start + 1; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

/** A score for `item` against `query`: higher is better, 0 is no match. An empty query matches everything (1). */
export function matchScore(query: string, item: Findable): number {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const fields = item.fields.filter((f) => f !== null && f !== undefined && f !== '').map((f) => String(f).toLowerCase());
  let total = 0;
  for (const w of words) {
    let best = 0;
    fields.forEach((f, i) => {
      const weight = i === 0 ? 3 : 1;
      if (f === w) best = Math.max(best, 10 * weight);
      else if (f.startsWith(w)) best = Math.max(best, 6 * weight);
      else if (f.split(/[\s@/._-]+/).some((part) => part.startsWith(w))) best = Math.max(best, 5 * weight);
      else if (f.includes(w)) best = Math.max(best, 3 * weight);
      else if (i === 0 && w.length >= 2 && abbreviates(w, f)) best = Math.max(best, 2);
    });
    if (!best) return 0;
    total += best;
  }
  return total;
}
