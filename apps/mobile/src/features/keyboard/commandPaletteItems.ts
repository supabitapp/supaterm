import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import {
  foldSearchQuery,
  PALETTE_SECONDARY_LIMIT,
  PALETTE_THREAD_LIMIT,
  rankSearchGroups,
  scoreSearchTerms,
  scoreThreadSearch,
  type SearchMatchHint,
  type SearchRange,
  type SearchTermsMatch,
  type ThreadSearchSubject,
} from "@supaterm/shared/paletteSearch";

export interface CommandPaletteItem {
  readonly key: string;
  readonly kind: "action" | "project" | "thread";
  readonly project?: EnvironmentProject;
  readonly title: string;
  readonly detail?: string;
  readonly searchTerms: ReadonlyArray<string>;

  readonly threadSearch?: ThreadSearchSubject;

  readonly secondary?: boolean;
  readonly run: () => void;
}

export interface CommandPaletteResult extends CommandPaletteItem {
  readonly fromMessages?: boolean;

  readonly titleRanges?: ReadonlyArray<SearchRange>;

  readonly matchHint?: SearchMatchHint;
}

export function filterCommandPaletteItems(
  items: ReadonlyArray<CommandPaletteItem>,
  query: string,
  messageMatchKeys: ReadonlyArray<string>,
  now = Date.now(),
): CommandPaletteResult[] {
  const actionsOnly = query.startsWith(">");
  const normalizedQuery = foldSearchQuery(actionsOnly ? query.slice(1) : query);
  const candidates = actionsOnly ? items.filter((item) => item.kind === "action") : items;
  if (!normalizedQuery) return candidates.filter((item) => item.kind !== "project");

  const kinds = ["action", "thread", "project"] as const;
  const groups = rankSearchGroups(
    kinds.map((kind) => ({ group: kind, items: candidates.filter((item) => item.kind === kind) })),
    (
      item,
      options,
    ): (SearchTermsMatch & { explain?: () => SearchMatchHint | undefined }) | null => {
      const match = item.threadSearch
        ? scoreThreadSearch(normalizedQuery, item.threadSearch, now, options)
        : scoreSearchTerms(normalizedQuery, [item.title, ...item.searchTerms], options);

      return match && item.secondary ? { ...match, groupQuality: 0 } : match;
    },
  );
  const threadsMatch = groups.some(({ group }) => group === "thread");
  const ranked = groups.flatMap(({ group, ranked: entries }) =>
    [...entries]

      .sort(
        (left, right) =>
          Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false),
      )
      .slice(
        0,
        group === "thread"
          ? PALETTE_THREAD_LIMIT
          : threadsMatch && !actionsOnly
            ? PALETTE_SECONDARY_LIMIT
            : entries.length,
      )
      .map(({ item, match }): CommandPaletteResult => {
        const matchHint = match.explain?.();
        return { ...item, titleRanges: match.ranges, ...(matchHint ? { matchHint } : {}) };
      }),
  );
  if (actionsOnly) return ranked;

  const listed = new Set(ranked.map((item) => item.key));
  const threadByKey = new Map(
    items.flatMap((item) => (item.kind === "thread" ? [[item.key, item] as const] : [])),
  );

  const fromMessages = messageMatchKeys.flatMap((key) => {
    const item = threadByKey.get(key);
    return item && !listed.has(key) ? [{ ...item, fromMessages: true }] : [];
  });
  return [...ranked, ...fromMessages];
}

export function nextPaletteIndex(index: number, direction: -1 | 1, count: number) {
  return count === 0 ? 0 : (index + direction + count) % count;
}
