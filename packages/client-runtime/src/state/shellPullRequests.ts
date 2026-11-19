import {
  OrchestrationV2ShellSnapshot,
  type ThreadId,
  ThreadPullRequestLink,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

export interface DeferredShellSnapshot extends OrchestrationV2ShellSnapshot {
  readonly loadPullRequests?: Effect.Effect<
    ReadonlyMap<ThreadId, ReadonlyArray<ThreadPullRequestLink>>
  >;
}

const yieldToHost = Effect.sleep("1 millis");

const decodeThreadLinks = Schema.decodeUnknownEffect(
  Schema.UndefinedOr(Schema.toCodecJson(Schema.Array(ThreadPullRequestLink))),
);

const LINKS_PER_BATCH = 400;

export function detachPullRequests(snapshot: unknown): ReadonlyArray<unknown> {
  if (!Predicate.isObject(snapshot)) return [];
  const rows: unknown = snapshot.threads;
  if (!Array.isArray(rows)) return [];
  return rows.map((row: unknown) => {
    if (!Predicate.isObject(row)) return undefined;
    const links = row.pullRequests;
    delete row.pullRequests;
    return links;
  });
}

export function deferPullRequests<S extends OrchestrationV2ShellSnapshot>(
  snapshot: S,
  rawLinks: ReadonlyArray<unknown>,
): S & Required<Pick<DeferredShellSnapshot, "loadPullRequests">> {
  const threadIds = snapshot.threads.map((thread) => thread.id);

  const loadPullRequests = Effect.gen(function* () {
    const linksByThreadId = new Map<ThreadId, ReadonlyArray<ThreadPullRequestLink>>();
    let batchSize = LINKS_PER_BATCH;
    for (const [index, threadId] of threadIds.entries()) {
      const raw = rawLinks[index];
      if (raw === undefined) continue;
      const size = Array.isArray(raw) ? raw.length : 1;
      if (batchSize + size > LINKS_PER_BATCH) {
        yield* yieldToHost;
        batchSize = 0;
      }
      batchSize += size;

      const links = yield* decodeThreadLinks(raw).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Discarding unreadable shell pull request links.", {
            threadId,
            cause: String(cause),
          }).pipe(Effect.as(undefined)),
        ),
      );
      if (links !== undefined) linksByThreadId.set(threadId, links);
    }
    return linksByThreadId as ReadonlyMap<ThreadId, ReadonlyArray<ThreadPullRequestLink>>;
  });
  return { ...snapshot, loadPullRequests };
}

const decodeShellSnapshotJson = Schema.decodeUnknownEffect(
  Schema.toCodecJson(OrchestrationV2ShellSnapshot),
);

export const decodeShellSnapshotDeferringPullRequests = Effect.fnUntraced(function* (
  json: unknown,
) {
  const rawLinks = detachPullRequests(json);
  const snapshot = yield* decodeShellSnapshotJson(json);
  return deferPullRequests(snapshot, rawLinks);
});
