import type { TranscriptionDictionaryEntry } from "@supaterm/contracts";

const UNIVERSAL_FILLER_WORDS = ["uh", "uhh", "uhm", "umm", "ehm", "erm", "hmm", "hm", "mmm"];

// "um" is a word in Portuguese, so it is only a filler where the language says so.
const LANGUAGE_FILLER_WORDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  en: ["um", "ah", "eh"],
  de: ["äh", "ähm"],
  fr: ["euh"],
};

// Marks count as part of a word, so a Devanagari vowel sign keeps its word whole.
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{M}\\p{N}_])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{M}\\p{N}_])";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const startsSentence = (text: string, offset: number) =>
  offset === 0 || /[.!?]\s*$/.test(text.slice(0, offset));

function removeFillerWords(text: string, language: string | undefined): string {
  const words = [...UNIVERSAL_FILLER_WORDS, ...(LANGUAGE_FILLER_WORDS[language ?? ""] ?? [])];
  const filler = `${NOT_WORD_BEFORE}(?:${words.map(escapeRegex).join("|")})${NOT_WORD_AFTER}`;
  const beforeStop = new RegExp(`(?:,\\s*|\\s+)?${filler}(?=\\s*[.!?])`, "giu");
  const elsewhere = new RegExp(`${filler},?\\s*(\\p{Ll})?`, "giu");
  // Collapsing first keeps every later pattern linear: none can backtrack across a long run.
  return text
    .replace(/\s{2,}/g, " ")
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

// Speech models join or split a name's words freely: "super term", "super-term", "superterm".
const spokenWords = (value: string) =>
  value
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((word) => word.length > 0);
const spokenKey = (value: string) => spokenWords(value).join("");

/** Rewrites each alias, and any casing of a term, to the term as the dictionary spells it. */
function applyDictionary(
  text: string,
  dictionary: ReadonlyArray<TranscriptionDictionaryEntry>,
): string {
  const spellings = new Map<string, string>();
  const alternatives: string[] = [];
  for (const entry of dictionary) {
    for (const heard of [entry.term, ...entry.aliases]) {
      const words = spokenWords(heard);
      const key = words.join("");
      // A spelling with no words would match the empty string everywhere.
      if (key.length === 0) continue;
      if (!spellings.has(key)) spellings.set(key, entry.term);
      alternatives.push(words.map(escapeRegex).join("[\\s-]*"));
    }
  }
  if (alternatives.length === 0) return text;
  alternatives.sort((left, right) => right.length - left.length);
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
