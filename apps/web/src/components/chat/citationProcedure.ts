import { useAtomValue } from "@effect/atom-react";
import { type AtomCommandSuccess, runAtomCommand } from "@supaterm/client-runtime/state/runtime";
import { htmlRenderFromToolItem, sentMessageFromToolItem } from "@supaterm/shared/toolOutput";
import { Atom, type AtomRegistry } from "effect/reactivity";
import type { TimelineEntry } from "../../session-logic";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { toastManager } from "../ui/toast";
import type { AssistantCitationRequest } from "./AssistantCitationSource";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

/** Whether the cited response is in the loaded history, after paging toward it. */
export type CitedHistory =
  | { readonly _tag: "loading" }
  | { readonly _tag: "found" }
  | { readonly _tag: "failed" };

export type CitationPhase =
  | { readonly _tag: "loading" }
  | { readonly _tag: "expanding" }
  | { readonly _tag: "ready"; readonly rowId: string }
  | { readonly _tag: "failed" };

export interface CitedThreadSnapshot {
  readonly message: "assistant" | "other" | null;
  readonly hasMoreHistory: boolean;
  readonly loadFailed?: true;
}

export type CitedHistoryOutcome =
  | { readonly _tag: "found" }
  | { readonly _tag: "failed"; readonly title: string; readonly description: string }
  | { readonly _tag: "aborted" };

type HistoryPageResult = AtomCommandSuccess<
  Awaited<ReturnType<typeof threadEnvironment.loadEarlierHistory.run>>
>;

const MAX_CITATION_PAGES = 20;

const COULD_NOT_LOAD = {
  _tag: "failed",
  title: "Could not load the cited response",
  description:
    "Load earlier turns, then click the citation to try again. Your saved quote is unchanged.",
} as const;

const UNAVAILABLE = {
  _tag: "failed",
  title: "The cited response is unavailable",
  description: "It may have been removed. The selected text is still saved in your citation.",
} as const;

/**
 * Pages history toward the cited message until it is loaded, the thread runs
 * out of history, or loading fails. `readThread` resolves once the thread
 * detail is settled (loaded and no history page in flight), or with null when
 * the signal aborts.
 */
export async function loadCitedHistory(input: {
  readonly signal: AbortSignal;
  readonly readThread: () => Promise<CitedThreadSnapshot | null>;
  readonly loadThrough: () => Promise<HistoryPageResult>;
}) {
  for (let attempts = 0; ; attempts += 1) {
    const thread = await input.readThread();
    if (thread === null || input.signal.aborted)
      return { _tag: "aborted" } satisfies CitedHistoryOutcome;
    if (thread.loadFailed) return COULD_NOT_LOAD satisfies CitedHistoryOutcome;
    if (thread.message === "assistant") return { _tag: "found" } satisfies CitedHistoryOutcome;
    if (thread.message === "other") {
      return {
        _tag: "failed",
        title: "The citation does not refer to an assistant response",
        description: "The selected text is still saved in your citation.",
      } satisfies CitedHistoryOutcome;
    }
    if (!thread.hasMoreHistory) return UNAVAILABLE satisfies CitedHistoryOutcome;
    if (attempts >= MAX_CITATION_PAGES) return COULD_NOT_LOAD satisfies CitedHistoryOutcome;
    const result = await input.loadThrough();
    if (input.signal.aborted) return { _tag: "aborted" } satisfies CitedHistoryOutcome;
    if (result._tag === "error") return COULD_NOT_LOAD satisfies CitedHistoryOutcome;
    if (result._tag === "noop") return UNAVAILABLE satisfies CitedHistoryOutcome;
  }
}

const isCited = (candidate: TimelineEntry | MessagesTimelineRow, messageId: string) =>
  (candidate.kind === "message" && candidate.message.id === messageId) ||
  ((candidate.kind === "html-render" || candidate.kind === "sent-message") &&
    candidate.id === messageId);

/** Where the citation stands for the rows the timeline currently shows. */
export function resolveCitationPhase(input: {
  readonly history: CitedHistory;
  readonly messageId: string;
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly rows: ReadonlyArray<MessagesTimelineRow>;
}) {
  if (input.history._tag === "failed") return { _tag: "failed" } satisfies CitationPhase;
  const source = input.entries.find((entry) => isCited(entry, input.messageId));
  if (!source) return { _tag: "loading" } satisfies CitationPhase;
  if (source.kind === "message" && source.message.role !== "assistant")
    return { _tag: "failed" } satisfies CitationPhase;
  const row = input.rows.find((candidate) => isCited(candidate, input.messageId));
  if (row) return { _tag: "ready", rowId: row.id } satisfies CitationPhase;
  return { _tag: "expanding" } satisfies CitationPhase;
}

type ThreadDetail<K extends keyof typeof environmentThreadDetails> = Atom.Type<
  ReturnType<(typeof environmentThreadDetails)[K]>
>;

/**
 * The cited thread as `loadCitedHistory` reads it, or null while it is still
 * settling. A thread that failed to load before any projection arrived counts
 * as settled, so the citation fails instead of waiting on the stream's retries.
 */
export function citedThreadSnapshot(input: {
  readonly thread: ThreadDetail<"quietThreadAtom">;
  readonly history: ThreadDetail<"historyAtom">;
  readonly status: ThreadDetail<"statusAtom">;
  readonly error: ThreadDetail<"errorAtom">;
  readonly messageId: string;
}) {
  if (input.history.loading) return null satisfies CitedThreadSnapshot | null;
  if (input.thread === null) {
    if (input.status === "deleted")
      return { message: null, hasMoreHistory: false } satisfies CitedThreadSnapshot | null;
    return (
      input.error === null ? null : { message: null, hasMoreHistory: false, loadFailed: true }
    ) satisfies CitedThreadSnapshot | null;
  }
  const item = input.thread.projection.visibleTurnItems.find(({ item }) =>
    item.type === "assistant_message" || item.type === "user_message"
      ? item.messageId === input.messageId
      : item.id === input.messageId,
  )?.item;
  const citable =
    item?.type === "assistant_message" ||
    (item?.type === "dynamic_tool" &&
      item.status === "completed" &&
      (htmlRenderFromToolItem(item) !== undefined || sentMessageFromToolItem(item) !== undefined));
  return {
    message: item === undefined ? null : citable ? "assistant" : "other",
    hasMoreHistory: input.history.hasMoreHistory,
  } satisfies CitedThreadSnapshot | null;
}

interface CitedHistoryKey {
  readonly key: string;
  readonly environmentId: AssistantCitationRequest["citation"]["environmentId"];
  readonly threadId: AssistantCitationRequest["citation"]["threadId"];
  readonly messageId: AssistantCitationRequest["citation"]["messageId"];
}

function waitForSettledThread(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<CitedThreadSnapshot | null>,
  signal: AbortSignal,
) {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let settled = false;
    const finish = (value: CitedThreadSnapshot | null) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    const check = (value: CitedThreadSnapshot | null) => {
      if (value !== null) finish(value);
    };
    signal.addEventListener("abort", onAbort);
    unsubscribe = registry.subscribe(atom, check);
    if (settled) unsubscribe();
    else check(registry.get(atom));
  }) satisfies Promise<CitedThreadSnapshot | null>;
}

const citedHistoryAtom = Atom.family(
  ({ key, environmentId, threadId, messageId }: CitedHistoryKey) => {
    const ref = { environmentId, threadId };
    const threadAtom = environmentThreadDetails.quietThreadAtom(ref);
    const historyAtom = environmentThreadDetails.historyAtom(ref);
    const statusAtom = environmentThreadDetails.statusAtom(ref);
    const errorAtom = environmentThreadDetails.errorAtom(ref);
    const settledThreadAtom = Atom.make((get) =>
      citedThreadSnapshot({
        thread: get(threadAtom),
        history: get(historyAtom),
        status: get(statusAtom),
        error: get(errorAtom),
        messageId,
      }),
    );
    return Atom.make((get) => {
      const controller = new AbortController();
      get.addFinalizer(() => controller.abort());
      void loadCitedHistory({
        signal: controller.signal,
        readThread: () => waitForSettledThread(get.registry, settledThreadAtom, controller.signal),
        loadThrough: async () => {
          const result = await runAtomCommand(
            get.registry,
            threadEnvironment.loadEarlierHistory,
            { environmentId, input: { threadId, throughEntryId: messageId } },
            { label: "load cited thread history", reportFailure: false },
          );
          return result._tag === "Success"
            ? result.value
            : { _tag: "error", message: "Could not load history." };
        },
      }).then((outcome) => {
        if (outcome._tag === "aborted") return;
        if (outcome._tag === "failed") {
          toastManager.add({
            type: "warning",
            title: outcome.title,
            description: outcome.description,
          });
        }
        get.setSelf({ _tag: outcome._tag });
      });
      return { _tag: "loading" } satisfies CitedHistory;
    }).pipe(Atom.withLabel(`assistant-citation:history:${key}`));
  },
);

const NO_CITED_HISTORY_ATOM = Atom.make<CitedHistory>({ _tag: "loading" });

export function useCitedHistory(request: AssistantCitationRequest | null) {
  return useAtomValue(
    request === null
      ? NO_CITED_HISTORY_ATOM
      : citedHistoryAtom({
          key: request.key,
          environmentId: request.citation.environmentId,
          threadId: request.citation.threadId,
          messageId: request.citation.messageId,
        }),
  ) satisfies CitedHistory;
}
