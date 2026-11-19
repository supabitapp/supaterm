import type { TranscriptionDictionaryEntry } from "@supaterm/contracts";

const UNSPACED_SCRIPTS = "\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}";
const WORD_CHARACTER = `[[\\p{L}\\p{M}\\p{N}_]--[${UNSPACED_SCRIPTS}]]`;
const NOT_WORD_BEFORE = `(?<!${WORD_CHARACTER})`;
const NOT_WORD_AFTER = `(?!${WORD_CHARACTER})`;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const spokenWords = (value: string) =>
  value
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((word) => word.length > 0);
const spokenKey = (value: string) => spokenWords(value).join("");

/** Rewrites each alias, and any casing of a term, to the term as the dictionary spells it. */
export function applyDictionary(
  text: string,
  dictionary: ReadonlyArray<TranscriptionDictionaryEntry>,
): string {
  const spellings = new Map<string, string>();
  const alternatives: string[] = [];
  for (const entry of dictionary) {
    for (const heard of [entry.term, ...entry.aliases]) {
      const words = spokenWords(heard);
      const key = words.join("");
      if (key.length === 0) continue;
      if (!spellings.has(key)) spellings.set(key, entry.term);
      alternatives.push(words.map(escapeRegex).join("[\\s\\-]*"));
    }
  }
  if (alternatives.length === 0) return text;
  alternatives.sort((left, right) => right.length - left.length);
  const pattern = new RegExp(
    `${NOT_WORD_BEFORE}(?:${alternatives.join("|")})${NOT_WORD_AFTER}`,
    "giv",
  );
  return text.replace(pattern, (match) => spellings.get(spokenKey(match)) ?? match);
}
