import type { OrchestrationV2ThreadOpens } from "@supaterm/contracts";

import { WORKTREE_BRANCH_PREFIX } from "./git.ts";

const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const LOWERCASE = /\p{Ll}/u;
const UPPERCASE = /\p{Lu}/u;
const DIGIT = /\p{N}/u;
const LETTER = /\p{L}/u;
const COMBINING_MARKS = /\p{M}/gu;
const SYMBOL = /\p{So}/u;
const APOSTROPHE = /['’]/;
const CURLY_APOSTROPHES = /[\u2018\u2019]/g;

interface SearchField {
  readonly text: string;
  readonly wordStarts: Uint8Array;
}

export interface SearchRange {
  readonly start: number;
  readonly end: number;
}
const fieldCache = new Map<string, SearchField>();
const FIELD_CACHE_LIMIT = 100_000;

function foldCharacter(character: string): string {
  return character
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace("ς", "σ")
    .replace(/[‘’]/, "'");
}

function foldInPlace(text: string): string {
  return text
    .replace(/[\u0080-\uffff]/g, (character) => {
      const folded = foldCharacter(character);
      return folded.length === 1 ? folded : character;
    })
    .toLowerCase();
}
function isCjk(character: string): boolean {
  const code = character.codePointAt(0)!;
  return (
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}
function hasCjkWord(token: string): boolean {
  return Array.from(token).some((character) => {
    const code = character.codePointAt(0)!;
    return isCjk(character) || (code >= 0xac00 && code <= 0xd7af);
  });
}

function isWordStart(
  beforePrevious: string,
  previous: string,
  character: string,
  next: string,
): boolean {
  const afterApostrophe = APOSTROPHE.test(previous) && ALPHANUMERIC.test(beforePrevious);
  return (
    (ALPHANUMERIC.test(character) || SYMBOL.test(character)) &&
    !afterApostrophe &&
    (previous === "" ||
      !ALPHANUMERIC.test(previous) ||
      (LOWERCASE.test(previous) && UPPERCASE.test(character)) ||
      (UPPERCASE.test(previous) && UPPERCASE.test(character) && LOWERCASE.test(next)) ||
      DIGIT.test(previous) !== DIGIT.test(character) ||
      isCjk(character))
  );
}

function foldSearchField(source: string): SearchField {
  const wordStarts = new Uint8Array(source.length);
  const characters = Array.from(source);
  let index = 0;
  for (const [position, character] of characters.entries()) {
    const previous = characters[position - 1] ?? "";
    const next = characters[position + 1] ?? "";
    if (isWordStart(characters[position - 2] ?? "", previous, character, next)) {
      wordStarts[index] = 1;
    }
    index += character.length;
  }
  return { text: foldInPlace(source), wordStarts };
}

function prepareSearchField(source: string): SearchField {
  const cached = fieldCache.get(source);
  if (cached) return cached;
  if (fieldCache.size >= FIELD_CACHE_LIMIT) {
    fieldCache.delete(fieldCache.keys().next().value!);
  }
  const field = foldSearchField(source);
  fieldCache.set(source, field);
  return field;
}
const WRAPPING_QUOTES = /^\s*["'`“”‘’]+|["'`“”‘’]+\s*$/g;

export function foldSearchQuery(query: string): string {
  return foldInPlace(query.replace(WRAPPING_QUOTES, "").normalize("NFC"))
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .join(" ");
}

function wordEnd(field: SearchField, index: number): number {
  let end = index + 1;
  while (end < field.text.length && !field.wordStarts[end] && ALPHANUMERIC.test(field.text[end]!)) {
    end++;
  }
  return end;
}
function withinOneEdit(left: string, right: string, swapOnly: boolean): boolean {
  if (Math.abs(left.length - right.length) > (swapOnly ? 0 : 1)) return false;
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index++;
  const restLeft = left.slice(index);
  const restRight = right.slice(index);
  const swapped =
    restLeft.length > 1 &&
    restLeft[0] === restRight[1] &&
    restLeft[1] === restRight[0] &&
    restLeft.slice(2) === restRight.slice(2);
  if (swapOnly) return swapped;
  return (
    swapped ||
    restLeft === restRight ||
    restLeft.slice(1) === restRight.slice(1) ||
    restLeft.slice(1) === restRight ||
    restLeft === restRight.slice(1)
  );
}

const WHOLE_WORD = 1;
const WHOLE_NAME = 1.5;
const MID_WORD = 0.3;
const TYPO = 0.45;
const JOINED_WORDS = 0.6;

interface TokenMatch extends SearchRange {
  readonly score: number;
  readonly letters?: ReadonlyArray<SearchRange>;
}

function matchToken(
  field: SearchField,
  token: string,
  typos: boolean,
  isPrimary: boolean,
  midWord: boolean,
): TokenMatch | null {
  if (token.length === 0) return null;
  let best: TokenMatch | null = null;
  const ownBoundary = !ALPHANUMERIC.test(token[0]!) && !SYMBOL.test(token[0]!);
  for (
    let index = field.text.indexOf(token);
    index !== -1;
    index = field.text.indexOf(token, index + 1)
  ) {
    if (field.wordStarts[index] || ownBoundary) {
      const end = index + token.length;
      const whole =
        end >= field.text.length ||
        field.wordStarts[end] === 1 ||
        !ALPHANUMERIC.test(field.text[end]!);
      let runEnd = end;
      while (runEnd < field.text.length && ALPHANUMERIC.test(field.text[runEnd]!)) runEnd++;
      const score = whole ? WHOLE_WORD : 0.7 + (0.2 * token.length) / (runEnd - index);
      if (best === null || score > best.score) {
        best = { score, start: index, end: index + token.length };
      }
      if (score === WHOLE_WORD) return best;
    } else if (midWord && token.length >= 4 && best === null) {
      best = { score: MID_WORD, start: index, end: index + token.length };
    }
  }
  if ((best === null || best.score <= MID_WORD) && isPrimary) {
    const joined = matchJoinedWords(field, token);
    if (joined) return joined;
  }
  if ((best !== null && best.score > MID_WORD) || !typos || token.length < 3) return best;
  if (LETTER.test(token)) {
    for (let index = 0; index < field.text.length; index++) {
      if (!field.wordStarts[index]) continue;
      const first = field.text[index];
      const firstLetterKept =
        first === token[0] ||
        (token.length > 3 && first === token[1] && field.text[index + 1] === token[0]);
      if (!firstLetterKept) continue;
      let runEnd = index + 1;
      while (runEnd < field.text.length && ALPHANUMERIC.test(field.text[runEnd]!)) runEnd++;
      const word = field.text.slice(index, runEnd);
      const short = token.length <= 4;
      const lengths = short
        ? [token.length, token.length + 1]
        : [token.length, token.length - 1, token.length + 1];
      for (const length of lengths) {
        if (length > word.length) continue;
        const prefix = word.slice(0, length);
        if (withinOneEdit(token, prefix, short && length === token.length)) {
          return { score: TYPO, start: index, end: index + length };
        }
      }
    }
  }
  return best;
}

function matchJoinedWords(field: SearchField, token: string): TokenMatch | null {
  const firstWord = field.wordStarts.indexOf(1);
  for (let start = 0; start < field.text.length; start++) {
    if (!field.wordStarts[start] || field.text[start] !== token[0]) continue;
    const runs: SearchRange[] = [];
    let at = start;
    let rest = token;
    while (rest.length > 0 && at < field.text.length) {
      const end = wordEnd(field, at);
      if (rest.length <= end - at && field.text.startsWith(rest, at)) {
        runs.push({ start: at, end: at + rest.length });
        rest = "";
      } else if (rest.startsWith(field.text.slice(at, end))) {
        runs.push({ start: at, end });
        rest = rest.slice(end - at);
        at = end;
        while (at < field.text.length && !field.wordStarts[at]) at++;
      } else {
        break;
      }
    }
    const last = runs.at(-1);
    if (rest.length > 0 || last === undefined || runs.length < 2) continue;
    if (
      last.end === wordEnd(field, last.start) ||
      last.end - last.start >= 3 ||
      start === firstWord ||
      runs.slice(0, -1).every((run) => run.end - run.start >= 3)
    ) {
      return { score: JOINED_WORDS, start, end: last.end, letters: runs };
    }
  }
  return null;
}

interface WeightedSearchField {
  readonly value: string;
  readonly weight: number;
  readonly wholeWords?: boolean;
  readonly keyword?: boolean;
  readonly context?: boolean;
  readonly midWord?: boolean;
}

interface SearchFieldsMatch {
  readonly quality: number;
  readonly strong: boolean;
  readonly primaryRanges: ReadonlyArray<SearchRange>;
}

const FILLER_WORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to", "with"]);
function mergeRanges(ranges: ReadonlyArray<SearchRange>): SearchRange[] {
  const merged: SearchRange[] = [];
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

function matchSearchFields(
  normalizedQuery: string,
  fields: ReadonlyArray<WeightedSearchField>,
  options?: { readonly typos?: boolean },
): SearchFieldsMatch | null {
  if (normalizedQuery.length === 0) return null;
  const prepared = fields.flatMap((field) =>
    field.value.length === 0
      ? []
      : [
          {
            field: prepareSearchField(field.value),
            weight: field.weight,
            wholeWords: field.wholeWords ?? false,
            keyword: field.keyword ?? false,
            context: field.context ?? false,
            allowMidWord: field.midWord ?? false,
          },
        ],
  );
  const primary = fields[0]?.value ? prepared[0]?.field : undefined;
  const tokens = normalizedQuery.split(" ").filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  const fillerOptional = tokens.some((token) => !FILLER_WORDS.has(token));
  const primaryRanges: SearchRange[] = [];
  let total = 0;
  let counted = 0;
  let strong = true;
  for (const token of tokens) {
    let best = 0;
    let bestPrimary: TokenMatch | null = null;
    let atWordStart = false;
    for (const { field, weight, wholeWords, keyword, context, allowMidWord } of prepared) {
      if (best >= weight && field !== primary && atWordStart) continue;
      const typos = (options?.typos ?? false) && !keyword;
      const match = matchToken(field, token, typos, field === primary, allowMidWord);
      if (match === null || match.score < (wholeWords ? WHOLE_WORD : keyword ? 0.7 : 0)) continue;
      if (field === primary) bestPrimary = match;
      if (match.score >= 0.7 && !context) atWordStart = true;
      if (match.score * weight > best) best = match.score * weight;
    }
    if (best === 0) {
      if (fillerOptional && FILLER_WORDS.has(token)) continue;
      return null;
    }
    strong &&= atWordStart;
    if (bestPrimary) primaryRanges.push(...(bestPrimary.letters ?? [bestPrimary]));
    total += best;
    counted += 1;
  }
  let quality = total / counted;
  if (primary) {
    if (primary.text === normalizedQuery) quality += WHOLE_NAME - WHOLE_WORD;
    else if (tokens.length > 1 && primary.text.includes(normalizedQuery)) quality += 0.25;
  }
  return {
    quality,
    strong,
    primaryRanges: mergeRanges(primaryRanges),
  };
}
const MESSAGE_TOKEN_MIN_LENGTH = 3;

export function messageSearchTokens(query: string): {
  readonly long: ReadonlyArray<string>;
  readonly short: ReadonlyArray<string>;
  readonly words: ReadonlyArray<string>;
} {
  const tokens = query
    .replace(WRAPPING_QUOTES, "")
    .replace(CURLY_APOSTROPHES, "'")
    .normalize("NFC")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const searchable = (token: string) => {
    const length = Array.from(token).length;
    return length >= MESSAGE_TOKEN_MIN_LENGTH || (length === 2 && hasCjkWord(token));
  };
  return {
    long: tokens.filter(searchable),
    short: tokens.filter((token) => !searchable(token)),
    words: tokens,
  };
}

export function messagePhrase(query: string): RegExp | null {
  const { words } = messageSearchTokens(query);
  return words.length > 1
    ? new RegExp(
        `(?<![\\p{L}\\p{N}])${words
          .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\s+")}(?![\\p{L}\\p{N}])`,
        "iu",
      )
    : null;
}
const MESSAGE_PHRASE_BONUS = 0.25;
const MESSAGE_NEAR_BONUS = 0.1;
const MESSAGE_NEAR_SPAN = 60;

const NON_ASCII = /[\u0080-\uffff]/;
const MESSAGE_WORD_START_LENGTH = 4;
const MESSAGE_PREFIX = 0.8;

function startsWordAt(text: string, index: number): boolean {
  const character = text[index]!;
  if (!ALPHANUMERIC.test(character) && !SYMBOL.test(character)) return true;
  return isWordStart(
    text[index - 2] ?? "",
    text[index - 1] ?? "",
    character,
    text[index + 1] ?? "",
  );
}
function endsWordAt(text: string, end: number): boolean {
  return end >= text.length || !ALPHANUMERIC.test(text[end]!) || startsWordAt(text, end);
}
const HEX_ID = /^(?=[a-f]*\d)[0-9a-f]{7,}$/i;
function findMessageToken(
  text: string,
  folded: string,
  token: string,
): { readonly at: ReadonlyArray<number>; readonly quality: number } | null {
  let quality = 0;
  let at: number[] = [];
  let run = { start: 0, end: -1, hex: false };
  for (let index = folded.indexOf(token); index !== -1; index = folded.indexOf(token, index + 1)) {
    if (index + token.length > run.end) {
      let start = index;
      while (start > 0 && ALPHANUMERIC.test(text[start - 1]!)) start--;
      let end = index + token.length;
      while (end < text.length && ALPHANUMERIC.test(text[end]!)) end++;
      run = { start, end, hex: HEX_ID.test(text.slice(start, end)) };
    }
    if (run.hex && run.start < index) continue;
    const found = !startsWordAt(text, index)
      ? MID_WORD
      : endsWordAt(text, index + token.length)
        ? 1
        : MESSAGE_PREFIX;
    if (found > quality) {
      quality = found;
      at = [index];
    } else if (found === quality) {
      at.push(index);
    }
  }
  return at.length === 0 ? null : { at, quality };
}

export interface MessageMatch {
  readonly quality: number;
  readonly offset: number;
}

export function messageMatcher(query: string): (text: string) => MessageMatch | null {
  const { long, short, words } = messageSearchTokens(query);
  const tokens = [...long, ...short].map((token) => ({
    token,
    folded: foldInPlace(token).replace(COMBINING_MARKS, ""),
    nonAscii: NON_ASCII.test(token),
    mustStartWord: Array.from(token).length < MESSAGE_WORD_START_LENGTH,
    grades: long.includes(token),
  }));
  const phrase = messagePhrase(query);
  const foldedPhrase = messagePhrase(
    words.map((word) => foldInPlace(word).replace(COMBINING_MARKS, "")).join(" "),
  );
  const queryNonAscii = NON_ASCII.test(query);
  return (text) => {
    const lower = text.toLowerCase();
    const plain = lower.length === text.length ? lower : foldInPlace(text);
    let folded: string | null = null;
    let quality = 1;
    const positions: Array<ReadonlyArray<number>> = [];
    for (const { token, folded: foldedToken, nonAscii, mustStartWord, grades } of tokens) {
      let found = findMessageToken(text, plain, token);
      if (found?.quality !== 1 && foldedToken.length > 0 && (nonAscii || NON_ASCII.test(text))) {
        found = findMessageToken(text, (folded ??= foldInPlace(text)), foldedToken);
      }
      if (found === null) return null;
      if (found.quality === MID_WORD && mustStartWord) return null;
      if (grades) quality = Math.min(quality, found.quality);
      positions.push(found.at);
    }
    const straight = (value: string) => value.replace(CURLY_APOSTROPHES, "'");
    const together =
      phrase?.exec(straight(plain)) ??
      (queryNonAscii || NON_ASCII.test(text)
        ? foldedPhrase?.exec(straight((folded ??= foldInPlace(text))))
        : null);
    if (together) return { quality: quality + MESSAGE_PHRASE_BONUS, offset: together.index };
    const near = shortestSpan(positions);
    return {
      quality:
        long.length > 1 && near.length <= MESSAGE_NEAR_SPAN
          ? quality + MESSAGE_NEAR_BONUS
          : quality,
      offset: near.start,
    };
  };
}
function shortestSpan(places: ReadonlyArray<ReadonlyArray<number>>): {
  readonly start: number;
  readonly length: number;
} {
  const hits = places
    .flatMap((at, word) => at.map((index) => ({ index, word })))
    .sort((left, right) => left.index - right.index);
  const counts = places.map(() => 0);
  let covered = 0;
  let best = { start: hits[0]?.index ?? 0, length: Number.POSITIVE_INFINITY };
  let left = 0;
  for (const hit of hits) {
    counts[hit.word] = (counts[hit.word] ?? 0) + 1;
    if (counts[hit.word] === 1) covered++;
    while (covered === places.length) {
      const first = hits[left]!;
      if (hit.index - first.index < best.length) {
        best = { start: first.index, length: hit.index - first.index };
      }
      counts[first.word] = (counts[first.word] ?? 1) - 1;
      if (counts[first.word] === 0) covered--;
      left++;
    }
  }
  return best;
}

export function findSearchTokenRanges(text: string, query: string): SearchRange[] {
  const tokens = new Map(
    messageSearchTokens(query)
      .long.map(
        (token) =>
          [foldSearchQuery(token), Array.from(token).length < MESSAGE_WORD_START_LENGTH] as const,
      )
      .filter(([token]) => token.length > 0),
  );
  if (tokens.size === 0) return [];
  const field = foldSearchField(text);
  const ranges: SearchRange[] = [];
  for (const [token, needsWordStart] of tokens) {
    const ownBoundary = !ALPHANUMERIC.test(token[0]!) && !SYMBOL.test(token[0]!);
    for (let index = field.text.indexOf(token); index !== -1;) {
      if (needsWordStart && !ownBoundary && !field.wordStarts[index]) {
        index = field.text.indexOf(token, index + 1);
        continue;
      }
      ranges.push({ start: index, end: index + token.length });
      index = field.text.indexOf(token, index + token.length);
    }
  }
  return mergeRanges(ranges);
}

export interface SearchTextPart {
  readonly text: string;
  readonly highlighted: boolean;
  readonly start: number;
}

export function splitSearchText(
  text: string,
  ranges: ReadonlyArray<SearchRange>,
): SearchTextPart[] {
  const parts: SearchTextPart[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push({ text: text.slice(cursor, range.start), highlighted: false, start: cursor });
    }
    parts.push({ text: text.slice(range.start, range.end), highlighted: true, start: range.start });
    cursor = range.end;
  }
  if (cursor < text.length || parts.length === 0) {
    parts.push({ text: text.slice(cursor), highlighted: false, start: cursor });
  }
  return parts;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const SEARCH_RECENCY_HALF_LIFE_MS = 14 * DAY_MS;
export const THREAD_OPEN_DEDUPE_MS = 10 * 60 * 1000;
const THREAD_SEARCH_PICK_LIMIT = 3;
const THREAD_SEARCH_PICK_MAX_LENGTH = 32;

export function pickedQuery(query: string): string {
  const cut = foldSearchQuery(query).slice(0, THREAD_SEARCH_PICK_MAX_LENGTH);
  return (/[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut).trim();
}

function decay(ageMs: number): number {
  return 2 ** (-Math.max(0, ageMs) / SEARCH_RECENCY_HALF_LIFE_MS);
}

export type ThreadOpenStats = OrchestrationV2ThreadOpens;

export function recordThreadOpen(
  previous: ThreadOpenStats | null,
  at: number,
  query: string | undefined,
): ThreadOpenStats {
  const pick = pickedQuery(query ?? "");
  const earlier = (previous?.picks ?? []).filter((entry) => at - entry.at <= PICK_WINDOW_MS);
  const picks = pick
    ? [{ query: pick, at }, ...earlier.filter((entry) => entry.query !== pick)].slice(
        0,
        THREAD_SEARCH_PICK_LIMIT,
      )
    : earlier;
  if (previous !== null && at - previous.openedAt < THREAD_OPEN_DEDUPE_MS) {
    return { ...previous, picks };
  }
  const score = previous === null ? 1 : previous.score * decay(at - previous.openedAt) + 1;
  return { openedAt: at, score, picks };
}

export interface ThreadSearchSubject {
  readonly id?: string;
  readonly title: string;
  readonly branch?: string | null;
  readonly projectTitle?: string | null;
  readonly environmentLabel?: string | null;
  readonly pullRequests?: ReadonlyArray<{
    readonly number: number;
    readonly title?: string | null;
    readonly references?: ReadonlyArray<string>;
  }>;
  readonly activityAt: number | null;
  readonly opens?: ThreadOpenStats | null;
}
const USE_BOOST_LIMIT = 2.5;

function threadUsageBoost(thread: ThreadSearchSubject, now: number): number {
  const recency = thread.activityAt === null ? 0 : decay(now - thread.activityAt);
  const opens = thread.opens ? thread.opens.score * decay(now - thread.opens.openedAt) : 0;
  return Math.min(USE_BOOST_LIMIT, 1 + recency + 0.5 * Math.log2(1 + opens));
}

const REFERENCE_PREFIX_MIN = 8;
function matchReference(
  normalizedQuery: string,
  thread: ThreadSearchSubject,
): SearchFieldsMatch | null {
  if (normalizedQuery.length < REFERENCE_PREFIX_MIN) return null;
  const references = [
    ...(thread.id ? [thread.id] : []),
    ...(thread.pullRequests ?? []).flatMap((pullRequest) => pullRequest.references ?? []),
  ];
  const anywhere = DIGIT.test(normalizedQuery);
  const notCut = (text: string, end: number) => !DIGIT.test(text[end] ?? "");
  return references.some((reference) => {
    const folded = reference.toLowerCase();
    const at = folded.indexOf(normalizedQuery);
    return anywhere
      ? (at !== -1 && notCut(folded, at + normalizedQuery.length)) ||
          (normalizedQuery.startsWith(folded) && notCut(normalizedQuery, folded.length))
      : at === 0;
  })
    ? { quality: 0.6, strong: true, primaryRanges: [] }
    : null;
}
const PICK_WINDOW_MS = 21 * DAY_MS;
const PICK_PREFIX_MIN_LENGTH = 3;

function activePick(
  thread: ThreadSearchSubject,
  normalizedQuery: string,
  now: number,
): ThreadOpenStats["picks"][number] | undefined {
  const query = pickedQuery(normalizedQuery);
  const prefix = query.length >= PICK_PREFIX_MIN_LENGTH;
  let exact: ThreadOpenStats["picks"][number] | undefined;
  let latest: ThreadOpenStats["picks"][number] | undefined;
  for (const pick of thread.opens?.picks ?? []) {
    if (now - pick.at > PICK_WINDOW_MS) continue;
    if (pick.query === query && (exact === undefined || pick.at > exact.at)) exact = pick;
    const matches = pick.query === query || (prefix && pick.query.startsWith(query));
    if (matches && (latest === undefined || pick.at > latest.at)) latest = pick;
  }
  return exact ?? latest;
}

export interface ThreadSearchMatch {
  readonly score: number;
  readonly quality: number;
  readonly strong: boolean;
  readonly ranges: ReadonlyArray<SearchRange>;
  readonly explain?: () => SearchMatchHint | undefined;
  readonly pickedAt?: number;
  readonly pickedExactly?: boolean;
  readonly groupQuality: number;
}

export interface SearchMatchHint {
  readonly label: string;
  readonly text: string;
  readonly ranges: ReadonlyArray<SearchRange>;
}
const WORKTREE_BRANCH_PREFIX_PATTERN = new RegExp(
  `^(?:${WORKTREE_BRANCH_PREFIX}|supaterm)/(?=\\S)`,
);

function searchableBranch(branch: string | null | undefined): string | null {
  return branch ? branch.replace(WORKTREE_BRANCH_PREFIX_PATTERN, "") : null;
}

function matchHint(
  normalizedQuery: string,
  thread: ThreadSearchSubject,
  typos: boolean,
): SearchMatchHint | undefined {
  const candidates: Array<{ readonly label: string; readonly text: string | null | undefined }> = [
    ...(thread.pullRequests ?? []).map((pullRequest) => ({
      label: "PR",
      text: `#${pullRequest.number}${pullRequest.title ? ` ${pullRequest.title}` : ""}`,
    })),
    { label: "Branch", text: searchableBranch(thread.branch) },
    { label: "Project", text: thread.projectTitle },
    { label: "Environment", text: thread.environmentLabel },
  ];
  const holds = (text: string, query: string) =>
    matchSearchFields(query, [{ value: text, weight: 1 }], { typos })?.primaryRanges;
  const hintFor = (query: string) => {
    for (const { label, text } of candidates) {
      const ranges = text ? holds(text, query) : undefined;
      if (text && ranges) return { label, text, ranges };
    }
    return undefined;
  };
  const whole = hintFor(normalizedQuery);
  if (whole) return whole;
  const contexts = [thread.projectTitle, thread.environmentLabel].filter(
    (text): text is string => !!text,
  );
  const rest = normalizedQuery
    .split(" ")
    .filter((token) => !contexts.some((text) => holds(text, token)))
    .join(" ");
  return rest && rest !== normalizedQuery ? hintFor(rest) : undefined;
}

export function scoreThreadSearch(
  normalizedQuery: string,
  thread: ThreadSearchSubject,
  now: number,
  options?: {
    readonly typos?: boolean;
    readonly picks?: boolean;
  },
): ThreadSearchMatch | null {
  const fields: WeightedSearchField[] = [{ value: thread.title, weight: 1, midWord: true }];
  for (const pullRequest of thread.pullRequests ?? []) {
    fields.push({ value: `#${pullRequest.number}`, weight: 1 });
    if (pullRequest.title) fields.push({ value: pullRequest.title, weight: 0.5 });
  }
  const branch = searchableBranch(thread.branch);
  if (branch) fields.push({ value: branch, weight: 0.6 });
  if (thread.projectTitle) {
    fields.push({ value: thread.projectTitle, weight: 0.25, context: true });
  }
  if (thread.environmentLabel) {
    fields.push({ value: thread.environmentLabel, weight: 0.25, context: true });
  }
  const fieldQuery = normalizedQuery
    .replace(/^(?:pr|pull request|pull)\s*(?=#?\d)/, "")
    .replace(/^#\s*/, "")
    .replace(WORKTREE_BRANCH_PREFIX_PATTERN, "");
  const fieldMatch = matchSearchFields(fieldQuery, fields, options);
  const referenceMatch = fieldMatch ? null : matchReference(normalizedQuery, thread);
  const match = fieldMatch ?? referenceMatch;
  if (match === null) return null;
  const typos = options?.typos ?? false;
  const titleShowsMatch = match.primaryRanges.length > 0;
  const checkHint = !titleShowsMatch && referenceMatch === null && fieldQuery.includes(" ");
  const checkedHint = checkHint ? matchHint(fieldQuery, thread, typos) : undefined;
  if (checkHint && checkedHint === undefined) return null;
  const explain = titleShowsMatch
    ? undefined
    : (): SearchMatchHint | undefined =>
        referenceMatch
          ? { label: "ID or link", text: normalizedQuery, ranges: [] }
          : (checkedHint ?? matchHint(fieldQuery, thread, typos));
  const pick = options?.picks === false ? undefined : activePick(thread, normalizedQuery, now);
  return {
    score: match.quality * threadUsageBoost(thread, now),
    quality: match.quality,
    groupQuality: Math.min(match.quality, WHOLE_NAME - 0.01),
    strong: match.strong,
    ranges: match.primaryRanges,
    ...(explain ? { explain } : {}),
    ...(pick ? { pickedAt: pick.at } : {}),
    ...(pick?.query === pickedQuery(normalizedQuery) ? { pickedExactly: true } : {}),
  };
}

export function threadRecentUse(thread: ThreadSearchSubject): number {
  return Math.max(thread.activityAt ?? 0, thread.opens?.openedAt ?? 0);
}

function messageMatchWeight(hits: number): number {
  return 1 + Math.log2(1 + hits);
}

export function rankMessageMatches<
  T extends {
    readonly quality?: number;
    readonly hits?: number;
    readonly messageCreatedAt?: string | null;
  },
>(
  matches: ReadonlyArray<T>,
  subjectOf: (match: T) => ThreadSearchSubject | undefined,
  normalizedQuery: string,
  now: number,
  options?: { readonly picks?: boolean; readonly withoutTitleMatches?: boolean },
): T[] {
  return matches
    .flatMap((match) => {
      const subject = subjectOf(match);
      if (!subject) return [];
      if (
        options?.withoutTitleMatches &&
        scoreThreadSearch(normalizedQuery, subject, now, { picks: false }) !== null
      ) {
        return [];
      }
      const quality = match.quality ?? 1;
      return [
        {
          match,
          quality,
          pickedAt:
            options?.picks === false ? 0 : (activePick(subject, normalizedQuery, now)?.at ?? 0),
          score: messageMatchWeight(match.hits ?? 1) * threadUsageBoost(subject, now),
        },
      ];
    })
    .sort(
      (left, right) =>
        Number(right.quality >= MESSAGE_PREFIX) - Number(left.quality >= MESSAGE_PREFIX) ||
        right.pickedAt - left.pickedAt ||
        right.quality - left.quality ||
        right.score - left.score ||
        (right.match.messageCreatedAt ?? "").localeCompare(left.match.messageCreatedAt ?? ""),
    )
    .map(({ match }) => match);
}

export const PALETTE_THREAD_LIMIT = 20;
export const PALETTE_MESSAGE_LIMIT = 10;
export const PALETTE_SECONDARY_LIMIT = 3;
function matchClass(quality: number): number {
  return quality >= WHOLE_NAME ? 3 : quality >= 0.7 ? 2 : quality >= 0.4 ? 1 : 0;
}

export interface RankedSearchItem<T, M> {
  readonly item: T;
  readonly match: M;
}

export function rankSearchGroups<
  G,
  T,
  M extends {
    readonly score: number;
    readonly quality: number;
    readonly strong: boolean;
    readonly pickedAt?: number;
    readonly pickedExactly?: boolean;
    readonly groupQuality?: number;
  },
>(
  groups: ReadonlyArray<{ readonly group: G; readonly items: ReadonlyArray<T> }>,
  score: (item: T, options: { readonly typos: boolean }, group: G) => M | null,
): Array<{ readonly group: G; readonly ranked: ReadonlyArray<RankedSearchItem<T, M>> }> {
  const rank = (typos: boolean) =>
    groups.map(({ group, items }) => ({
      group,
      ranked: items.flatMap((item) => {
        const match = score(item, { typos }, group);
        return match === null ? [] : [{ item, match }];
      }),
    }));
  let ranked = rank(false);
  if (!ranked.some((entry) => entry.ranked.some(({ match }) => match.strong))) {
    ranked = rank(true);
  }
  return ranked
    .flatMap(({ group, ranked: items }, order) => {
      if (items.length === 0) return [];
      const wordMatch = (match: M) => Math.min(matchClass(match.quality), 2);
      const exactPickAt = (match: M) => (match.pickedExactly ? (match.pickedAt ?? 0) : 0);
      const sorted = [...items].sort(
        (left, right) =>
          wordMatch(right.match) - wordMatch(left.match) ||
          exactPickAt(right.match) - exactPickAt(left.match) ||
          matchClass(right.match.quality) - matchClass(left.match.quality) ||
          (right.match.pickedAt ?? 0) - (left.match.pickedAt ?? 0) ||
          right.match.score - left.match.score,
      );
      const best = Math.max(
        ...items.map(({ match }) => matchClass(match.groupQuality ?? match.quality)),
      );
      return [{ group, ranked: sorted, best, order }];
    })
    .sort((left, right) => right.best - left.best || left.order - right.order)
    .map(({ group, ranked: items }) => ({ group, ranked: items }));
}

export function rankSearchItems<
  T,
  M extends { readonly score: number; readonly quality: number; readonly strong: boolean },
>(
  items: ReadonlyArray<T>,
  score: (item: T, options: { readonly typos: boolean }) => M | null,
): ReadonlyArray<RankedSearchItem<T, M>> {
  return rankSearchGroups([{ group: null, items }], score)[0]?.ranked ?? [];
}

export interface SearchTermsMatch {
  readonly score: number;
  readonly quality: number;
  readonly groupQuality?: number;
  readonly strong: boolean;
  readonly ranges: ReadonlyArray<SearchRange>;
}

const KEYWORD_QUALITY = 0.65;
const KEYWORD_QUERY_MIN_LENGTH = 4;

export function scoreSearchTerms(
  normalizedQuery: string,
  terms: ReadonlyArray<string>,
  options?: { readonly typos?: boolean },
): SearchTermsMatch | null {
  const meaningful = normalizedQuery
    .split(" ")
    .filter((token) => !FILLER_WORDS.has(token))
    .join(" ");
  const short = (meaningful || normalizedQuery).length < KEYWORD_QUERY_MIN_LENGTH;
  const match = matchSearchFields(
    normalizedQuery,
    terms.map((value, index) =>
      index === 0
        ? { value, weight: 1 }
        : { value, weight: short ? 0.8 : 0.6, wholeWords: short, keyword: true },
    ),
    options,
  );
  return (
    match && {
      score: match.quality,
      quality: match.quality,
      ...(match.primaryRanges.length > 0
        ? {}
        : { groupQuality: Math.min(match.quality, KEYWORD_QUALITY) }),
      strong: match.strong,
      ranges: match.primaryRanges,
    }
  );
}
