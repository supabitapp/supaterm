import type { TranscriptionDictionaryEntry } from "@supaterm/contracts";

const UNIVERSAL_FILLER_WORDS = ["uh", "uhh", "uhm", "umm", "ehm", "erm", "hmm", "hm", "mmm"];

// "um" is a word in Portuguese, so it is only a filler where the language says so.
const LANGUAGE_FILLER_WORDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  en: ["um", "ah", "eh"],
  de: ["äh", "ähm"],
  fr: ["euh"],
};

const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}_])";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const startsSentence = (text: string, offset: number) =>
  offset === 0 || /[.!?]\s*$/.test(text.slice(0, offset));

export function removeFillerWords(text: string, language: string | undefined): string {
  const words = [...UNIVERSAL_FILLER_WORDS, ...(LANGUAGE_FILLER_WORDS[language ?? ""] ?? [])];
  const filler = `${NOT_WORD_BEFORE}(?:${words.map(escapeRegex).join("|")})${NOT_WORD_AFTER}`;
  const beforeStop = new RegExp(`(?:,\\s*|\\s+)?${filler}(?=\\s*[.!?])`, "giu");
  const elsewhere = new RegExp(`${filler},?\\s*(\\p{Ll})?`, "giu");
  return text
    .replace(beforeStop, (match, offset: number, whole: string) =>
      startsSentence(whole, offset) ? match : "",
    )
    .replace(elsewhere, (_match, next: string | undefined, offset: number, whole: string) =>
      next === undefined ? "" : startsSentence(whole, offset) ? next.toUpperCase() : next,
    )
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const spokenKey = (value: string) =>
  value
    .toLowerCase()
    .split(/[\s-]+/)
    .join(" ");

/** Rewrites each alias, and any casing of a term, to the term as the dictionary spells it. */
export function applyDictionary(
  text: string,
  dictionary: ReadonlyArray<TranscriptionDictionaryEntry>,
): string {
  const spellings = new Map<string, string>();
  for (const entry of dictionary) {
    for (const heard of [entry.term, ...entry.aliases]) {
      const key = spokenKey(heard);
      if (!spellings.has(key)) spellings.set(key, entry.term);
    }
  }
  if (spellings.size === 0) return text;
  const alternatives = [...spellings.keys()]
    .toSorted((left, right) => right.length - left.length)
    .map((key) => key.split(" ").map(escapeRegex).join("[\\s-]+"));
  const pattern = new RegExp(
    `${NOT_WORD_BEFORE}(?:${alternatives.join("|")})${NOT_WORD_AFTER}`,
    "giu",
  );
  return text.replace(pattern, (match) => spellings.get(spokenKey(match)) ?? match);
}

export function cleanTranscript(
  text: string,
  options: {
    readonly language: string | undefined;
    readonly removeFillerWords: boolean;
    readonly dictionary: ReadonlyArray<TranscriptionDictionaryEntry>;
  },
): string {
  const spoken = options.removeFillerWords ? removeFillerWords(text, options.language) : text;
  return applyDictionary(spoken, options.dictionary);
}
