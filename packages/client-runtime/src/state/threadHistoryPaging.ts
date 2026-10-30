import type { ThreadId } from "@supaterm/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import type * as Semaphore from "effect/Semaphore";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/http";

import type { PreparedConnection } from "../connection/model.ts";
import type { ThreadHistoryLoadEarlierResult } from "./threadHistoryController.ts";
import { fetchEnvironmentThreadHistoryPage } from "./threadHistoryHttp.ts";
import {
  applyHistoryPageMeta,
  clearActiveHistoryLoading,
  EMPTY_THREAD_HISTORY_META,
  isActiveHistoryRequestCursor,
  mergeOlderHistoryIntoProjection,
} from "./threadHistoryMerge.ts";
import type { EnvironmentThreadState } from "./threadState.ts";

class HistoryUnavailable extends Data.TaggedError("HistoryUnavailable")<{
  readonly message: string;
}> {}

function formatHistoryError(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Could not load earlier activity.";
}

function workCursor(state: EnvironmentThreadState, anchorId: string): string | null {
  return (
    Option.getOrNull(state.data)?.visibleTurnItems.find((row) => row.sourceItemId === anchorId)
      ?.item.deferredWork?.cursor ?? null
  );
}

function staleWorkResult(
  state: EnvironmentThreadState,
  anchorId: string,
): ThreadHistoryLoadEarlierResult {
  return workCursor(state, anchorId) === null
    ? { _tag: "noop" }
    : { _tag: "error", message: "Work history changed. Retry loading it." };
}

export function makeThreadHistoryPaging(input: {
  readonly threadId: ThreadId;
  readonly state: SubscriptionRef.SubscriptionRef<EnvironmentThreadState>;
  readonly prepared: SubscriptionRef.SubscriptionRef<Option.Option<PreparedConnection>>;
  readonly httpClient: Option.Option<HttpClient.HttpClient>;
  readonly awaitingCompletion: Ref.Ref<boolean>;
  readonly applyLock: Semaphore.Semaphore;
  readonly remember: Effect.Effect<void>;
}) {
  const { state, applyLock } = input;
  const fetchPage = Effect.fn("ThreadHistoryPaging.fetchPage")(function* (
    cursor: string,
    target: { readonly throughEntryId?: string; readonly view?: "conversation" | "work" },
  ) {
    const prepared = yield* SubscriptionRef.get(input.prepared);
    if (Option.isNone(prepared) || Option.isNone(input.httpClient))
      return yield* new HistoryUnavailable({ message: "Environment is not connected." });
    return yield* fetchEnvironmentThreadHistoryPage({
      prepared: prepared.value,
      threadId: input.threadId,
      cursor,
      ...target,
    }).pipe(Effect.provideService(HttpClient.HttpClient, input.httpClient.value));
  });

  const loadEarlier = Effect.fn("ThreadHistoryPaging.loadEarlier")(function* (
    throughEntryId?: string,
  ): Effect.fn.Return<ThreadHistoryLoadEarlierResult> {
    const current = yield* SubscriptionRef.get(state);
    if (
      current.status === "deleted" ||
      Option.isNone(current.data) ||
      current.history.historyCursor === null ||
      !current.history.hasMoreHistory
    )
      return { _tag: "noop" };
    if (current.history.loading) return { _tag: "busy" };
    let requestCursor = current.history.historyCursor;
    const isCurrent = (latest: EnvironmentThreadState) =>
      isActiveHistoryRequestCursor(requestCursor, latest.history);
    yield* SubscriptionRef.update(state, (latest) =>
      isCurrent(latest)
        ? { ...latest, history: { ...latest.history, loading: true, error: null } }
        : latest,
    );
    const fail = (error: unknown) => {
      const message = formatHistoryError(error);
      return SubscriptionRef.modify(
        state,
        (latest): readonly [ThreadHistoryLoadEarlierResult, EnvironmentThreadState] =>
          isCurrent(latest)
            ? [
                { _tag: "error", message },
                { ...latest, history: { ...latest.history, loading: false, error: message } },
              ]
            : [{ _tag: "noop" }, latest],
      );
    };
    const load = Effect.gen(function* () {
      while (true) {
        const views =
          throughEntryId === undefined ? [undefined] : ["conversation" as const, undefined];
        let nextCursor: string | null = null;
        for (const view of views) {
          const result = yield* fetchPage(requestCursor, {
            ...(throughEntryId === undefined ? {} : { throughEntryId }),
            ...(view === undefined ? {} : { view }),
          }).pipe(Effect.result);
          if (Result.isFailure(result)) return yield* fail(result.failure);
          const page = result.success;
          const complete = view !== "conversation";
          const keepPaging =
            complete &&
            throughEntryId === undefined &&
            page.hasMoreHistory &&
            !page.items.some(
              ({ item }) => item.type === "user_message" && item.createdBy === "user",
            );
          if (keepPaging && (page.nextCursor === null || page.nextCursor === requestCursor))
            return yield* fail(new Error("History did not advance."));
          const waiting = yield* Ref.get(input.awaitingCompletion);
          const applied = yield* applyLock.withPermits(1)(
            SubscriptionRef.modify(
              state,
              (latest): readonly [ThreadHistoryLoadEarlierResult, EnvironmentThreadState] => {
                if (!isCurrent(latest)) return [{ _tag: "noop" }, latest];
                if (Option.isNone(latest.data) || latest.status === "deleted")
                  return [{ _tag: "noop" }, { ...latest, history: EMPTY_THREAD_HISTORY_META }];
                return [
                  { _tag: "loaded" },
                  {
                    ...latest,
                    data: Option.some(
                      mergeOlderHistoryIntoProjection(latest.data.value, page.items),
                    ),
                    status: complete && waiting ? "synchronizing" : latest.status,
                    history: complete
                      ? { ...applyHistoryPageMeta(latest.history, page), loading: keepPaging }
                      : { ...latest.history, expanded: true },
                  },
                ];
              },
            ),
          );
          if (applied._tag !== "loaded") return applied;
          if (complete) yield* applyLock.withPermits(1)(input.remember);
          nextCursor = keepPaging ? page.nextCursor : null;
        }
        if (nextCursor === null) return { _tag: "loaded" } as const;
        requestCursor = nextCursor;
      }
    });
    return yield* load.pipe(
      Effect.onInterrupt(() =>
        SubscriptionRef.update(state, (latest) => ({
          ...latest,
          history: clearActiveHistoryLoading(requestCursor, latest.history),
        })),
      ),
    );
  });

  const expandWork = Effect.fn("ThreadHistoryPaging.expandWork")(function* (
    anchorId: string,
  ): Effect.fn.Return<ThreadHistoryLoadEarlierResult> {
    const current = yield* SubscriptionRef.get(state);
    const initialCursor = workCursor(current, anchorId);
    if (current.status === "deleted" || Option.isNone(current.data) || initialCursor === null)
      return { _tag: "noop" };
    let requestCursor = initialCursor;
    const fail = Effect.fnUntraced(function* (error: unknown) {
      const latest = yield* SubscriptionRef.get(state);
      return workCursor(latest, anchorId) === requestCursor
        ? ({ _tag: "error", message: formatHistoryError(error) } as const)
        : staleWorkResult(latest, anchorId);
    });
    while (true) {
      const result = yield* fetchPage(requestCursor, {
        throughEntryId: anchorId,
        view: "work",
      }).pipe(Effect.result);
      if (Result.isFailure(result)) return yield* fail(result.failure);
      const page = result.success;
      if (page.nextCursor === requestCursor)
        return yield* fail(new Error("Work history did not advance."));
      const applied = yield* applyLock.withPermits(1)(
        SubscriptionRef.modify(
          state,
          (latest): readonly [ThreadHistoryLoadEarlierResult, EnvironmentThreadState] => {
            if (workCursor(latest, anchorId) !== requestCursor)
              return [staleWorkResult(latest, anchorId), latest];
            if (Option.isNone(latest.data) || latest.status === "deleted")
              return [{ _tag: "noop" }, latest];
            return [
              { _tag: "loaded" },
              {
                ...latest,
                data: Option.some(
                  mergeOlderHistoryIntoProjection(latest.data.value, page.items, {
                    anchorId,
                    nextCursor: page.nextCursor,
                  }),
                ),
                history: { ...latest.history, expanded: true },
              },
            ];
          },
        ),
      );
      if (applied._tag !== "loaded") return applied;
      yield* applyLock.withPermits(1)(input.remember);
      if (page.nextCursor === null) return { _tag: "loaded" };
      requestCursor = page.nextCursor;
    }
  });

  return { loadEarlier, expandWork };
}
