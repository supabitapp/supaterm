import {
  CommandId,
  isOrchestrationV2WorkActive,
  type OrchestrationV2TurnItem,
  type PullRequestSummary,
  type ThreadId,
  type ThreadPullRequestKey,
  type ThreadPullRequestLink,
  type ThreadPullRequestSnapshot,
  type ThreadPullRequestStack,
  isOrchestrationV2RunSettled,
} from "@supaterm/contracts";
import { makeDrainableWorker } from "@supaterm/shared/DrainableWorker";
import * as KeyedLock from "@supaterm/shared/KeyedLock";
import {
  threadPullRequestKeyOf,
  normalizeThreadPullRequestKey,
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "../sourceControl/threadPullRequests.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as GitManager from "../git/GitManager.ts";
import { PullRequestProviderError } from "@supaterm/source-control-core/server/PullRequestProvider";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const SLOW_SYNC_INTERVAL_MS = 15 * 60 * 1_000;
export const QUIET_AFTER_MS = 30 * 60 * 1_000;
export const QUIET_SYNC_INTERVAL_MS = 5 * 60 * 1_000;
const CLOSED_FINAL_AFTER_MS = 24 * 60 * 60 * 1_000;
const FAILED_READ_BACKOFF_MS = 60 * 1_000;

const isChangeRequestCloseCommand = (command: string) =>
  sourceControlDefinitions.definitions.some(
    (definition) => definition.changeRequestCloseCommand?.test(command) === true,
  );

const COMMAND_START =
  "(?:^|[;&|({`\\n]|\\b(?:do|then|else)\\s)\\s*(?:(?:\\w+=\\S*|env|time|nohup|timeout\\s+\\S+)\\s+)*";
const CREATE_COMMANDS = sourceControlDefinitions.definitions.flatMap(
  ({ kind, changeRequestCreateCommand: command }) =>
    command === undefined
      ? []
      : [
          {
            kind,
            command,
            run: new RegExp(`${COMMAND_START}${command.source}(?=$|[\\s;&|)])`, "gu"),
          },
        ],
);
const createCommandCount = (code: string) =>
  CREATE_COMMANDS.reduce((count, { run }) => count + [...code.matchAll(run)].length, 0);
const PUSH_COMMAND = new RegExp(
  `${COMMAND_START}(?:git(?:\\s+-[cC]\\s+\\S+)*\\s+push|gh\\s+stack\\s+(?:push|submit)|cafe\\s+stack\\s+submit|jj\\s+git\\s+push)(?=$|[\\s;&|)])`,
  "u",
);

const SHELL_WRAPPER = /^\s*(?:\S*\/)?(?:ba|z|da|k)?sh\s+-l?c\s+(?=["'])([\s\S]*)$/u;
const SHELL_WORD_PIECE = /"((?:\\[\s\S]|[^"\\])*)"|'([^']*)'|\\([\s\S])|(\S)/gu;
const HEREDOC_BODY =
  /<<-?[ \t]*(['"]?)(\w+)\1[^\n]*\n(?:(?:[\s\S]*?\n)?[ \t]*\2[ \t]*(?=\n|$)|[\s\S]*$)/gu;
const QUOTED_OR_COMMENT = /'[^']*'|"(?:\\[\s\S]|[^"\\])*"|(?<=^|[\s;&|(])#[^\n]*/gmu;
const COMMAND_SEPARATOR = /&&|\|\||[;|\n]/u;
const LISTS_CHANGE_REQUESTS =
  /\b(?:gh\s+(?:pr\s+(?:list|status)|search\s+prs|api)|glab\s+(?:mr\s+list|api))\b/u;
const URL_LINE = /^[ \t]*(https?:\/\/\S+)[ \t]*$/gmu;

function shellScript(input: string): string {
  const [, wrapped] = SHELL_WRAPPER.exec(input) ?? [];
  return wrapped === undefined
    ? input
    : Array.from(
        wrapped.matchAll(SHELL_WORD_PIECE),
        ([, double, single, escaped, bare]) =>
          double?.replace(/\\(["\\$`])/gu, "$1") ?? single ?? escaped ?? bare,
      ).join("");
}

function shellSegments(script: string): ReadonlyArray<string> {
  const segments: Array<string> = [];
  let current = "";
  let quote: string | null = null;
  for (let index = 0; index < script.length; index++) {
    const char = script[index] ?? "";
    if (quote !== null) {
      current += char;
      if (char === "\\" && quote === '"') current += script[++index] ?? "";
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    if (char === "\\") {
      current += char + (script[++index] ?? "");
      continue;
    }
    const pair = script.slice(index, index + 2);
    if (pair === "&&" || pair === "||" || char === ";" || char === "|" || char === "\n") {
      segments.push(current);
      current = "";
      if (pair === "&&" || pair === "||") index++;
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

const shellCode = (script: string) =>
  script.replace(HEREDOC_BODY, "<<").replace(QUOTED_OR_COMMENT, "''");

const isPushCommand = (input: string) => PUSH_COMMAND.test(shellCode(shellScript(input)));

type CommandExecution = Extract<OrchestrationV2TurnItem, { readonly type: "command_execution" }>;

function changeRequestsCreatedBy(input: string, output: string) {
  if (!CREATE_COMMANDS.some(({ command }) => command.test(input))) return [];
  const script = shellScript(input);
  const code = shellCode(script);
  const creates = createCommandCount(code);
  if (creates === 0) return [];
  const otherCommands = code
    .split(COMMAND_SEPARATOR)
    .filter((part) => createCommandCount(part) === 0)
    .join("\n");
  if (LISTS_CHANGE_REQUESTS.test(otherCommands)) return [];
  const otherScript = shellSegments(script)
    .filter((segment) => createCommandCount(shellCode(segment)) === 0)
    .join("\n");
  const creators = new Set(
    CREATE_COMMANDS.filter(({ run }) => code.match(run) !== null).map(({ kind }) => kind),
  );
  const created = new Map<string, ThreadPullRequestKey & { readonly url: string }>();
  for (const [, url = ""] of output.matchAll(URL_LINE)) {
    const parsed = sourceControlDefinitions.parseChangeRequestUrl(url);
    if (parsed === null || !creators.has(parsed.definition.kind)) continue;
    const { link } = parsed;
    const named = new RegExp(`(?:^|(?<=[\\s#/=("']))${link.number}(?=$|[\\s);&|/"'])`, "u");
    if (named.test(otherScript)) continue;
    const key = normalizeThreadPullRequestKey(link);
    created.set(threadPullRequestKeyOf(key), { ...key, url });
  }
  return created.size > creates ? [] : [...created.values()];
}

const isPullRequestProviderError = Schema.is(PullRequestProviderError);

type SnapshotFields = Omit<ThreadPullRequestSnapshot, "syncedAt">;

interface LinkEntry {
  readonly thread: ProjectionStore.ProjectionThreadPullRequests;
  readonly link: ThreadPullRequestLink;
}

const referenceOf = ({ thread, link }: LinkEntry) => ({
  projectId: thread.projectId,
  host: normalizeThreadPullRequestKey(link).host,
  repository: link.repository,
  number: link.number,
});

const pauseKeyOf = (entry: LinkEntry) => {
  const { projectId, host } = referenceOf(entry);
  return `${projectId}\0${host}`;
};

function siblingChangeRequestUrl(url: string, number: number): string | null {
  if (!Number.isSafeInteger(number) || number < 1) return null;
  const parsed = sourceControlDefinitions.parseChangeRequestUrl(url);
  if (parsed === null) return null;
  const { definition, link } = parsed;
  return definition.changeRequestUrl({
    host: link.host,
    repository: link.repository,
    number,
    webUrl: link.repositoryUrl,
  });
}

function snapshotFieldsOf(summary: PullRequestSummary): SnapshotFields {
  return {
    state: summary.state,
    title: summary.title,
    headBranch: summary.headBranch,
    baseBranch: summary.baseBranch,
    isDraft: summary.isDraft ?? false,
    updatedAt: summary.updatedAt,
    closedAt: summary.closedAt ?? null,
    mergedAt: summary.mergedAt ?? null,
    ...(summary.author === undefined ? {} : { author: summary.author }),
    ...(summary.additions === undefined ? {} : { additions: summary.additions }),
    ...(summary.deletions === undefined ? {} : { deletions: summary.deletions }),
    ...(summary.changedFiles === undefined ? {} : { changedFiles: summary.changedFiles }),
    ...(summary.reviewDecision === undefined ? {} : { reviewDecision: summary.reviewDecision }),
    ...(summary.checksState === undefined ? {} : { checksState: summary.checksState }),
    ...(summary.mergeability === undefined ? {} : { mergeability: summary.mergeability }),
    ...(summary.rebaseRequired === undefined ? {} : { rebaseRequired: summary.rebaseRequired }),
  };
}

function withKnownMergeability(
  previous: ThreadPullRequestSnapshot | null,
  fields: SnapshotFields,
  provider: PullRequestSummary["provider"],
): SnapshotFields {
  if (
    provider !== "github" ||
    fields.state !== "open" ||
    fields.mergeability !== "unknown" ||
    previous?.updatedAt !== fields.updatedAt
  )
    return fields;
  const known = previous?.state === "open" ? previous.mergeability : undefined;
  return known === undefined || known === "unknown" ? fields : { ...fields, mergeability: known };
}

function avatarIdentity(avatarUrl: string | null | undefined): string | null {
  if (avatarUrl === null || avatarUrl === undefined) return null;
  const url = URL.parse(avatarUrl);
  if (url === null || (url.hostname !== "ghe.com" && !url.hostname.endsWith(".ghe.com"))) {
    return avatarUrl;
  }
  url.searchParams.delete("token");
  return url.href;
}

function snapshotFieldsEqual(left: SnapshotFields, right: SnapshotFields): boolean {
  return (
    left.state === right.state &&
    left.title === right.title &&
    left.headBranch === right.headBranch &&
    left.baseBranch === right.baseBranch &&
    left.isDraft === right.isDraft &&
    left.updatedAt === right.updatedAt &&
    (left.closedAt ?? null) === (right.closedAt ?? null) &&
    (left.mergedAt ?? null) === (right.mergedAt ?? null) &&
    (left.author?.login ?? null) === (right.author?.login ?? null) &&
    avatarIdentity(left.author?.avatarUrl) === avatarIdentity(right.author?.avatarUrl) &&
    left.additions === right.additions &&
    left.deletions === right.deletions &&
    left.changedFiles === right.changedFiles &&
    (left.reviewDecision ?? null) === (right.reviewDecision ?? null) &&
    (left.checksState ?? null) === (right.checksState ?? null) &&
    left.mergeability === right.mergeability &&
    left.rebaseRequired === right.rebaseRequired
  );
}

function stacksEqual(
  left: ThreadPullRequestStack | null,
  right: ThreadPullRequestStack | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.kind === right.kind &&
    left.id === right.id &&
    left.number === right.number &&
    left.url === right.url &&
    left.base === right.base &&
    left.layers.length === right.layers.length &&
    left.layers.every((layer, index) => {
      const other = right.layers[index]!;
      return (
        layer.number === other.number &&
        layer.headBranch === other.headBranch &&
        layer.state === other.state
      );
    })
  );
}

function nativeStackKeyOf(link: ThreadPullRequestLink, stack: ThreadPullRequestStack): string {
  const key = normalizeThreadPullRequestKey(link);
  return `${key.host}/${key.repository}#stack:${stack.id}`;
}

function sameLayerNumbers(left: ThreadPullRequestStack, right: ThreadPullRequestStack): boolean {
  return (
    left.layers.length === right.layers.length &&
    left.layers.every((layer, index) => layer.number === right.layers[index]!.number)
  );
}

function skipReason(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
}

function rateLimitRetryAt(cause: Cause.Cause<unknown>): number | undefined {
  let error: unknown = Cause.squash(cause);
  while (error instanceof Error) {
    if (isPullRequestProviderError(error) && error.reason === "rate-limited") return error.retryAt;
    error = error.cause;
  }
  return undefined;
}

function isOpen(thread: ProjectionStore.ProjectionThreadPullRequests): boolean {
  return thread.doneOverride !== "done" && thread.doneAt === null;
}

export class PullRequestSyncReactor extends Context.Service<
  PullRequestSyncReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
    /**
     * Force the next sweep to re-read this pull request, even when its snapshot is terminal.
     * While its host is rate limited, the read waits for the first sweep after the pause.
     */
    readonly requestSync: (key: ThreadPullRequestKey) => Effect.Effect<void>;
  }
>()("supaterm/orchestration-v2/PullRequestSyncReactor") {}

/** @public */
export const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const git = yield* GitManager.GitManager;
  const random = yield* SecureRandom.SecureRandom;

  const lastSyncedAt = new Map<string, number>();
  const requested = new Set<string>();

  const pendingRequests = new Set<string>();

  let requestedSweepQueued = false;
  const retryStacks = new Set<string>();
  const failedReads = new Map<string, { readonly retryAtMs: number; readonly backoffMs: number }>();
  const missing = new Set<string>();
  const pausedUntil = new Map<string, number>();

  const isDue = (key: string, entries: ReadonlyArray<LinkEntry>, nowMs: number): boolean => {
    if ((failedReads.get(key)?.retryAtMs ?? 0) > nowMs) return false;
    if (requested.has(key)) return true;
    const active = entries.filter((entry) => isOpen(entry.thread));
    if (active.length === 0) return false;
    const last = lastSyncedAt.get(key);
    const sinceLastMs = last === undefined ? Number.POSITIVE_INFINITY : nowMs - last;
    if (missing.has(key)) return sinceLastMs >= SLOW_SYNC_INTERVAL_MS;
    if (retryStacks.has(key) || active.some((entry) => entry.link.snapshot === null)) return true;

    const isFinal = ({ link: { snapshot } }: LinkEntry) =>
      snapshot?.state === "merged"
        ? snapshot.mergedAt != null
        : snapshot?.state === "closed" &&
          nowMs - Date.parse(snapshot.closedAt ?? "") >= CLOSED_FINAL_AFTER_MS;
    if (active.every(isFinal)) return false;
    const open = active.filter((entry) => entry.link.snapshot?.state === "open");
    if (open.length > 0) {
      const quiet = open.every((entry) => {
        const updatedAt = entry.link.snapshot?.updatedAt;
        return updatedAt != null && nowMs - Date.parse(updatedAt) >= QUIET_AFTER_MS;
      });
      return !quiet || sinceLastMs >= QUIET_SYNC_INTERVAL_MS;
    }
    return sinceLastMs >= SLOW_SYNC_INTERVAL_MS;
  };

  const logSkipped =
    (message: string, fields: Record<string, unknown>) =>
    <E>(cause: Cause.Cause<E>): Effect.Effect<void, E> =>
      Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.logWarning(message, fields);

  const sweep = Effect.fn("PullRequestSyncReactor.sweep")(function* (scope: "all" | "requested") {
    const threads = yield* projections.getThreadsWithPullRequests();
    const now = yield* DateTime.now;
    const nowMs = DateTime.toEpochMillis(now);
    const nowIso = DateTime.formatIso(now);

    const groups = new Map<string, Array<LinkEntry>>();
    for (const thread of threads) {
      for (const link of visibleThreadPullRequests(thread.pullRequests ?? [])) {
        const key = `${thread.projectId}\0${threadPullRequestKeyOf(link)}`;
        const entries = groups.get(key) ?? [];
        entries.push({ thread, link });
        groups.set(key, entries);
      }
    }

    for (const [key, entries] of groups) {
      if (!pendingRequests.has(threadPullRequestKeyOf(entries[0]!.link))) continue;
      requested.add(key);
      const failed = failedReads.get(key);
      if (failed !== undefined) failedReads.set(key, { ...failed, retryAtMs: nowMs });
    }
    pendingRequests.clear();

    for (const key of lastSyncedAt.keys()) if (!groups.has(key)) lastSyncedAt.delete(key);
    for (const key of retryStacks) if (!groups.has(key)) retryStacks.delete(key);
    for (const key of failedReads.keys()) if (!groups.has(key)) failedReads.delete(key);
    for (const key of missing) if (!groups.has(key)) missing.delete(key);
    for (const key of requested.keys()) if (!groups.has(key)) requested.delete(key);

    const linkedThisSweep = new Set<string>();
    const stacksReadThisSweep = new Map<string, ThreadPullRequestStack | null>();
    const persistence = yield* Semaphore.make(1);

    const syncEntry = Effect.fnUntraced(function* (
      entry: LinkEntry,
      hostFields: SnapshotFields,
      fetchedStack: { readonly stack: ThreadPullRequestStack | null } | null,
      provider: PullRequestSummary["provider"],
    ) {
      const { thread, link } = entry;
      const fields = withKnownMergeability(link.snapshot, hostFields, provider);
      const nextStack = fetchedStack === null ? link.stack : fetchedStack.stack;
      const changed =
        link.snapshot === null ||
        !snapshotFieldsEqual(link.snapshot, fields) ||
        !stacksEqual(link.stack, nextStack);
      for (const layer of isOpen(thread) ? (fetchedStack?.stack?.layers ?? []) : []) {
        const layerKey = {
          host: normalizeThreadPullRequestKey(link).host,
          repository: link.repository,
          number: layer.number,
        };
        const dedupeKey = `${thread.id}:${threadPullRequestKeyOf(layerKey)}`;
        if (linkedThisSweep.has(dedupeKey)) continue;
        if (
          (thread.pullRequests ?? []).some((existing) =>
            threadPullRequestKeysEqual(existing, layerKey),
          )
        ) {
          continue;
        }
        const url = siblingChangeRequestUrl(link.url, layer.number);
        if (url === null) continue;
        const uuid = yield* random.uuidV4();
        yield* engine.dispatch({
          type: "thread.pull-request.link",
          commandId: CommandId.make(`server:pr-stack-link:${thread.id}:${uuid}`),
          threadId: thread.id,
          ...layerKey,
          url,
          source: "stack",
        });
        linkedThisSweep.add(dedupeKey);
      }
      if (changed) {
        const uuid = yield* random.uuidV4();
        yield* engine.dispatch({
          type: "thread.pull-request-link.sync",
          commandId: CommandId.make(`server:pr-sync:${thread.id}:${uuid}`),
          threadId: thread.id,
          host: normalizeThreadPullRequestKey(link).host,
          repository: link.repository,
          number: link.number,
          snapshot: { ...fields, syncedAt: nowIso },
          stack: nextStack,
        });
      }
    }, Effect.withSpan("PullRequestSyncReactor.syncEntry"));

    const syncGroup = Effect.fnUntraced(function* (key: string, entries: ReadonlyArray<LinkEntry>) {
      const first = entries[0]!;
      const ref = referenceOf(first);
      const refreshRequested = requested.has(key);

      const missingMergedAt = entries.some(
        (entry) => entry.link.snapshot?.state === "merged" && entry.link.snapshot.mergedAt == null,
      );
      const invalidated = refreshRequested || missingMergedAt || retryStacks.has(key);
      if (invalidated) yield* pullRequests.invalidate({ reference: ref });
      const summary = yield* pullRequests.summary(ref, { recoverTransientFailure: false }).pipe(
        Effect.tapError((error) =>
          error.reason === "not-found" || error._tag === "PullRequestUnavailableError"
            ? Effect.sync(() => {
                missing.add(key);
                lastSyncedAt.set(key, nowMs);
                requested.delete(key);
              })
            : Effect.void,
        ),
      );
      missing.delete(key);
      const fields = snapshotFieldsOf(summary);
      const needsStack =
        refreshRequested ||
        retryStacks.has(key) ||
        entries.some(
          (entry) =>
            entry.link.snapshot === null ||
            !snapshotFieldsEqual(
              entry.link.snapshot,
              withKnownMergeability(entry.link.snapshot, fields, summary.provider),
            ) ||
            (summary.stack !== undefined &&
              (entry.link.stack?.number ?? null) !== (summary.stack?.number ?? null)),
        );
      const knownUnstacked =
        summary.stack === null && entries.every((entry) => entry.link.stack === null);
      if (!invalidated && retryStacks.has(key) && !knownUnstacked) {
        yield* pullRequests.invalidate({ reference: ref });
      }
      if (needsStack) retryStacks.delete(key);
      const fetchedStack = !needsStack
        ? null
        : knownUnstacked
          ? { stack: null }
          : yield* pullRequests.stack(ref, { includeDetails: false }).pipe(
              Effect.map((stack) => ({
                stack: stack === null ? null : ({ kind: "native", ...stack } as const),
              })),
              Effect.catchCauseIf(
                (cause) => !Cause.hasInterruptsOnly(cause),
                (cause) =>
                  rateLimitRetryAt(cause) !== undefined
                    ? Effect.sync(() => retryStacks.add(key)).pipe(
                        Effect.andThen(Effect.failCause(cause)),
                      )
                    : Effect.logWarning("pull request stack lookup failed", {
                        key,
                      }).pipe(Effect.as(null)),
              ),
            );
      if (needsStack) {
        if (fetchedStack === null) {
          retryStacks.add(key);
          return;
        }
        const fetched = fetchedStack.stack;
        stacksReadThisSweep.set(key, fetched);
        if (fetched !== null) {
          const fetchedKey = nativeStackKeyOf(first.link, fetched);
          for (const [siblingKey, siblingEntries] of groups) {
            if (siblingKey === key) continue;
            if (siblingEntries[0]!.thread.projectId !== first.thread.projectId) continue;
            const readThisSweep = stacksReadThisSweep.get(siblingKey);
            const stale = siblingEntries.some(({ link }) => {
              const stack = readThisSweep === undefined ? link.stack : readThisSweep;
              return (
                stack !== null &&
                nativeStackKeyOf(link, stack) === fetchedKey &&
                !sameLayerNumbers(stack, fetched)
              );
            });
            if (stale) retryStacks.add(siblingKey);
          }
        }
      }
      lastSyncedAt.set(key, nowMs);
      failedReads.delete(key);
      requested.delete(key);
      yield* Effect.forEach(
        entries,
        (entry) =>
          syncEntry(entry, fields, fetchedStack, summary.provider).pipe(
            persistence.withPermits(1),
            Effect.catchCause((cause) => {
              if (!Cause.hasInterruptsOnly(cause)) retryStacks.add(key);
              return logSkipped("pull request sync skipped", { threadId: entry.thread.id, key })(
                cause,
              );
            }),
          ),
        { discard: true },
      );
    }, Effect.withSpan("PullRequestSyncReactor.syncGroup"));

    const skips = new Map<string, { count: number; readonly key: string }>();
    const readGroup = (key: string, entries: ReadonlyArray<LinkEntry>, pauseKey: string) =>
      syncGroup(key, entries).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
          const retryAt = rateLimitRetryAt(cause);
          if (retryAt !== undefined) {
            pausedUntil.set(pauseKey, Math.max(retryAt, pausedUntil.get(pauseKey) ?? 0));
          } else {
            const previous = failedReads.get(key);
            const backoffMs =
              previous === undefined
                ? FAILED_READ_BACKOFF_MS
                : Math.min(previous.backoffMs * 2, SLOW_SYNC_INTERVAL_MS);
            failedReads.set(key, { retryAtMs: nowMs + backoffMs, backoffMs });
          }
          const reason = skipReason(cause);
          const skip = skips.get(reason);
          if (skip === undefined) skips.set(reason, { count: 1, key });
          else skip.count += 1;
          return Effect.void;
        }),
      );
    const pools = {
      batched: { width: 100, reads: yield* Semaphore.make(100) },
      unbatched: { width: 25, reads: yield* Semaphore.make(25) },
    };
    const isPaused = (pauseKey: string, atMs: number) => (pausedUntil.get(pauseKey) ?? 0) > atMs;
    const readIfDue = (
      key: string,
      entries: ReadonlyArray<LinkEntry>,
      pauseKey: string,
      reads: Semaphore.Semaphore,
    ) =>
      reads.withPermits(1)(
        Effect.suspend(() =>
          isDue(key, entries, nowMs)
            ? Clock.currentTimeMillis.pipe(
                Effect.flatMap((startedAtMs) =>
                  isPaused(pauseKey, startedAtMs) ? Effect.void : readGroup(key, entries, pauseKey),
                ),
              )
            : Effect.void,
        ),
      );
    const groupsByHost = Map.groupBy(
      Array.from(groups).filter(([key]) => scope === "all" || requested.has(key)),
      ([, entries]) => pauseKeyOf(entries[0]!),
    );
    yield* Effect.forEach(
      groupsByHost,
      ([pauseKey, hostGroups]) => {
        if (
          isPaused(pauseKey, nowMs) ||
          !hostGroups.some(([key, entries]) => isDue(key, entries, nowMs))
        ) {
          return Effect.void;
        }
        return pullRequests.batchesReads(referenceOf(hostGroups[0]![1][0]!)).pipe(
          Effect.flatMap((batches) => {
            const { width, reads } = batches ? pools.batched : pools.unbatched;
            return Effect.forEach(
              hostGroups,
              ([key, entries]) => readIfDue(key, entries, pauseKey, reads),
              {
                concurrency: width,
                discard: true,
              },
            );
          }),
        );
      },
      { concurrency: "unbounded", discard: true },
    );
    for (const [reason, { count, key }] of skips) {
      yield* Effect.logWarning("pull request sync skipped", { count, key, reason });
    }
  });

  const worker = yield* makeDrainableWorker((scope: "all" | "requested") =>
    Effect.suspend(() => {
      if (scope === "requested") requestedSweepQueued = false;
      return pullRequests.withSharedProjectReads(sweep(scope));
    }).pipe(Effect.catchCause(logSkipped("pull request sync sweep failed", {}))),
  );

  const closeCommands = new Map<ThreadId, Set<string>>();
  const refreshUnmergedLinks = (threadId: ThreadId) =>
    projections.getThreadsWithPullRequests(threadId).pipe(
      Effect.flatMap((threads) =>
        Effect.forEach(
          threads.flatMap((thread) =>
            visibleThreadPullRequests(thread.pullRequests ?? []).filter(
              (link) => link.snapshot?.state === "open" || link.snapshot?.state === "closed",
            ),
          ),
          requestSync,
          { discard: true },
        ),
      ),
      Effect.catchCause(logSkipped("pull request refresh after run skipped", { threadId })),
    );

  const requestUnsyncedLinks = Effect.fnUntraced(
    function* (threadId: ThreadId, links: ReadonlyArray<ThreadPullRequestLink>) {
      const unsynced = links.filter((link) => link.snapshot === null);
      if (unsynced.length === 0) return;
      const [thread] =
        missing.size === 0 ? [] : yield* projections.getThreadsWithPullRequests(threadId);
      for (const link of unsynced) {
        if (
          thread !== undefined &&
          missing.has(`${thread.projectId}\0${threadPullRequestKeyOf(link)}`)
        ) {
          continue;
        }
        yield* requestSync(link);
      }
    },
    Effect.catchCause(logSkipped("pull request refresh after link update skipped", {})),
  );

  const linkCreatedChangeRequests = Effect.fn("PullRequestSyncReactor.linkCreatedChangeRequests")(
    function* (threadId: ThreadId, item: CommandExecution) {
      if (isOrchestrationV2WorkActive(item.status)) return;
      yield* Effect.forEach(
        changeRequestsCreatedBy(item.input, item.output ?? ""),
        (created) =>
          engine
            .dispatch({
              type: "thread.pull-request.link",
              commandId: CommandId.make(
                `server:pr-created-link:${threadId}:${item.id}:${threadPullRequestKeyOf(created)}`,
              ),
              threadId,
              ...created,
              source: "created",
            })
            .pipe(
              Effect.catchCause(
                logSkipped("linking a pull request a command created failed", { threadId }),
              ),
            ),
        { discard: true },
      );
    },
  );

  const reopenWatchedChecks = Effect.fn("PullRequestSyncReactor.reopenWatchedChecks")(
    function* (threadId: ThreadId, item: CommandExecution) {
      if (isOrchestrationV2WorkActive(item.status) || !isPushCommand(item.input)) return;
      const threads = yield* projections.getThreadsWithPullRequests(threadId);
      const answered = threads.some((thread) =>
        (thread.pullRequests ?? []).some((link) => link.watch?.checksPending !== undefined),
      );
      if (!answered) return;
      yield* engine.dispatch({
        type: "thread.pull-request-watch.checks-reopen",
        commandId: CommandId.make(`server:pr-push-checks:${threadId}:${item.id}`),
        threadId,
      });
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catchCause(
          logSkipped("reopening a watch's checks after a push failed", { threadId }),
        ),
      ),
  );

  const start: PullRequestSyncReactor["Service"]["start"] = Effect.fn(
    "PullRequestSyncReactor.start",
  )(function* () {
    const events = engine.streamDomainEvents;
    const threadReactions = yield* KeyedLock.makeRunner<ThreadId>();
    const inThreadOrder = <E>(threadId: ThreadId, reaction: Effect.Effect<void, E>) =>
      threadReactions.run(
        threadId,
        Effect.catchCause(reaction, (cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("pull request sync reaction failed", { threadId, cause }),
        ),
      );
    const stateChanges = Stream.merge(
      yield* pullRequests.subscribeStateChanges,
      yield* git.subscribePullRequestStateChanges,
    );
    yield* forkParked(
      Stream.runForEach(stateChanges, requestSync).pipe(
        Effect.catchCause(logSkipped("pull request state change stream failed", {})),
      ),
    );
    yield* forkParked(
      Stream.runForEach(events, (event) => {
        switch (event.type) {
          case "thread.pull-request-link-updated":
            return requestUnsyncedLinks(event.threadId, [event.payload]);
          case "thread.pull-request-synced":
            return requestUnsyncedLinks(
              event.threadId,
              visibleThreadPullRequests(event.payload.pullRequests ?? []),
            );
          case "turn-item.updated": {
            const item = event.payload;
            if (item.type !== "command_execution") return Effect.void;
            let reaction = Effect.andThen(
              linkCreatedChangeRequests(event.threadId, item),
              reopenWatchedChecks(event.threadId, item),
            );
            const active = isOrchestrationV2WorkActive(item.status);
            if (isChangeRequestCloseCommand(item.input)) {
              const ended = closeCommands.get(event.threadId) ?? new Set<string>();
              closeCommands.set(event.threadId, ended);
              if (!active && !ended.has(item.id)) {
                ended.add(item.id);
                reaction = Effect.andThen(reaction, refreshUnmergedLinks(event.threadId));
              }
            }
            return active ? Effect.void : inThreadOrder(event.threadId, reaction);
          }
          case "thread.marked-done":
            return inThreadOrder(event.threadId, refreshUnmergedLinks(event.threadId));
          case "run.updated":
            return isOrchestrationV2RunSettled(event.payload.status) &&
              closeCommands.delete(event.threadId)
              ? inThreadOrder(event.threadId, refreshUnmergedLinks(event.threadId))
              : Effect.void;
          default:
            return Effect.void;
        }
      }).pipe(Effect.catchCause(logSkipped("pull request sync event stream failed", {}))),
    );
    yield* forkParked(
      Effect.gen(function* () {
        yield* worker.enqueue("all");
        yield* worker.drain;
      }).pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.asVoid),
    );
  });

  const requestSync: PullRequestSyncReactor["Service"]["requestSync"] = (key) =>
    Effect.suspend(() => {
      pendingRequests.add(threadPullRequestKeyOf(key));
      if (requestedSweepQueued) return Effect.void;
      requestedSweepQueued = true;
      return worker.enqueue("requested");
    });

  return { start, drain: worker.drain, requestSync } satisfies PullRequestSyncReactor["Service"];
});

export const layer = Layer.effect(PullRequestSyncReactor, make);
