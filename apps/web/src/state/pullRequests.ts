import { useAtomValue } from "@effect/atom-react";
import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import {
  applyPullRequestSummaryEdits,
  createLinkedPullRequestSummaryAtomFamily,
  createPullRequestEnvironmentAtoms,
  createPullRequestStackAtomFamily,
  pullRequestPendingEditsFor,
  pullRequestHostAnswer,
  type PullRequestPendingEdit,
} from "@supaterm/client-runtime/state/pull-requests";
import {
  PullRequestListResult,
  PullRequestOperationError,
  PullRequestUnavailableError,
  type EnvironmentId,
  type ProjectId,
  type PullRequestChecksState,
  type PullRequestFilesViewedResult,
  type PullRequestListInput,
  type PullRequestFilterOptionsInput,
  type PullRequestListStatsInput,
  type PullRequestListEntry,
  type PullRequestRef,
  type PullRequestSummary,
  type ThreadPullRequestLink,
} from "@supaterm/contracts";
import {
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@supaterm/client-runtime/thread-pull-requests";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  mergePullRequestLists,
  type MergedPullRequestList,
} from "../components/pullRequest/pullRequestList.logic";
import { writePullRequestDetailSnapshot } from "../components/pullRequest/pullRequestDetail.logic";
import { pullRequestChecksState } from "../components/pullRequest/pullRequestPresentation";
import { useGuideRunStore } from "../components/pullRequest/guide/guideRunStore";
import { formatEnvironmentQueryError } from "./query";
import { environmentThreadShells } from "./threads";

export interface ObservedPullRequestSummary {
  readonly summary: PullRequestSummary;
  /** Client arrival time, the only ordering older servers leave us for same-dated snapshots. */
  readonly observedAt: number;
}

function compareSummaries(current: PullRequestSummary, incoming: PullRequestSummary) {
  const merged = Number(incoming.state === "merged") - Number(current.state === "merged");
  if (merged !== 0) return merged;
  const updated = Date.parse(incoming.updatedAt) - Date.parse(current.updatedAt);
  if (updated !== 0) return updated;
  if (current.observedAt === undefined && incoming.observedAt === undefined) return 0;
  return (incoming.observedAt ?? -Infinity) - (current.observedAt ?? -Infinity);
}

export function newestPullRequestSummary(
  current: PullRequestSummary | null,
  observed: PullRequestSummary | null,
) {
  if (current === null) return observed;
  if (observed === null) return current;
  return compareSummaries(current, observed) >= 0 ? observed : current;
}

/** A stored snapshot carries no edit, so a shared summary dated the same wins over it. */
export function newestDisplayedPullRequestSummary(
  detail: PullRequestSummary | null,
  fromSnapshot: boolean,
  shared: PullRequestSummary | null,
  reference: PullRequestRef,
  edits: ReadonlyArray<PullRequestPendingEdit>,
) {
  return applyPullRequestSummaryEdits(
    reference,
    fromSnapshot
      ? newestPullRequestSummary(detail, shared)
      : newestPullRequestSummary(shared, detail),
    edits,
  );
}

export function pullRequestListEntryToSummary(entry: PullRequestListEntry) {
  return {
    provider: entry.provider,
    projectId: entry.projectId,
    repository: entry.repository,
    number: entry.number,
    title: entry.title,
    url: entry.url,
    state: entry.state,
    isDraft: entry.isDraft,
    headBranch: entry.headBranch,
    baseBranch: entry.baseBranch,
    updatedAt: entry.updatedAt,
    ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
    author: entry.author,
    ...(entry.reviewDecision === undefined ? {} : { reviewDecision: entry.reviewDecision }),
    ...(entry.checksState === undefined ? {} : { checksState: entry.checksState }),
    mergeability: entry.mergeability,
  };
}

function pullRequestSummaryKey(environmentId: EnvironmentId, reference: PullRequestRef) {
  return JSON.stringify([
    environmentId,
    reference.projectId,
    reference.repository.toLowerCase(),
    reference.number,
  ]);
}

export function newestPullRequestObservation(
  current: ObservedPullRequestSummary | null,
  incoming: ObservedPullRequestSummary | null,
) {
  if (current === null) return incoming;
  if (incoming === null) return current;
  let order = compareSummaries(current.summary, incoming.summary);
  if (
    order === 0 &&
    current.summary.observedAt === undefined &&
    incoming.summary.observedAt === undefined
  ) {
    order = incoming.observedAt - current.observedAt;
  }
  if (!(order > 0)) return current;
  return {
    ...incoming,
    summary: {
      ...incoming.summary,
      isDraft: incoming.summary.isDraft ?? current.summary.isDraft,
      mergeability: incoming.summary.mergeability ?? current.summary.mergeability,
      reviewDecision:
        incoming.summary.reviewDecision === undefined
          ? current.summary.reviewDecision
          : incoming.summary.reviewDecision,
      checksState:
        incoming.summary.checksState === undefined
          ? current.summary.checksState
          : incoming.summary.checksState,
    },
  };
}

export interface ObservedPullRequestChecks {
  readonly checksState: PullRequestChecksState | null;
  /** Server read time, when the server reports one. */
  readonly readAt: number | undefined;
  /** Client arrival time. */
  readonly observedAt: number;
}

/**
 * Checks are reread far more often than the rest of a pull request, so they keep their own
 * freshness: a checks read must not carry old metadata forward, and a list read must not take
 * back newer checks.
 */
export interface PullRequestObservations {
  readonly metadata: ObservedPullRequestSummary | null;
  readonly checks: ObservedPullRequestChecks | null;
}

const noObservations: PullRequestObservations = { metadata: null, checks: null };

const pullRequestObservationsAtom = Atom.family((key: string) =>
  Atom.make<PullRequestObservations>(noObservations).pipe(
    Atom.setIdleTTL(5 * 60_000),
    Atom.withLabel(`web-pull-requests:observations:${key}`),
  ),
);

export function observePullRequestChecks(
  current: PullRequestObservations,
  incoming: ObservedPullRequestChecks,
) {
  const previous = current.checks;
  const newer =
    previous === null ||
    (previous.readAt !== undefined && incoming.readAt !== undefined
      ? incoming.readAt >= previous.readAt
      : incoming.observedAt >= previous.observedAt);
  return newer ? { ...current, checks: incoming } : current;
}

export function observePullRequestMetadata(
  current: PullRequestObservations,
  incoming: ObservedPullRequestSummary,
) {
  const metadata = newestPullRequestObservation(current.metadata, incoming);
  const next = metadata === current.metadata ? current : { ...current, metadata };
  const { checksState } = incoming.summary;
  return checksState === undefined
    ? next
    : observePullRequestChecks(next, {
        checksState,
        readAt: incoming.summary.observedAt,
        observedAt: incoming.observedAt,
      });
}

export function observedPullRequestSummary(observations: PullRequestObservations) {
  const { metadata, checks } = observations;
  if (metadata === null) return null;
  return checks === null
    ? metadata.summary
    : { ...metadata.summary, checksState: checks.checksState };
}

function recordObservation(
  registry: AtomRegistry.AtomRegistry,
  key: string,
  observe: (current: PullRequestObservations) => PullRequestObservations,
) {
  registry.modify(pullRequestObservationsAtom(key), (previous) => {
    const next = observe(previous);
    return next === previous ? [false, previous] : [true, next];
  });
}

function observePullRequestSummary(
  registry: AtomRegistry.AtomRegistry,
  key: string,
  summary: PullRequestSummary,
  observedAt: number,
) {
  recordObservation(registry, key, (current) =>
    observePullRequestMetadata(current, { summary, observedAt }),
  );
}

function snapshotStorage() {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

type ListAnswerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const LIST_SCOPE_INDEX_KEY = "supaterm.pullRequests.listScopes";
const LIST_SCOPE_KEY_PREFIX = "supaterm.pullRequests.listScope:";
const LEGACY_SNAPSHOT_KEY_PREFIX = "supaterm.pullRequests.list:";
const LIST_ANSWER_MAX_ENTRIES = 99;
const LIST_SCOPE_MAX_KEPT = 8;
const listScopeCodec = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.toCodecJson(PullRequestListResult)),
);
const decodeListScope = Schema.decodeUnknownOption(listScopeCodec);
const encodeListScope = Schema.encodeOption(listScopeCodec);
const decodeListScopeIndex = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);
const sweptStorages = new WeakSet<ListAnswerStorage>();

const listScopeKey = ({ projectIds: _projectIds, ...scope }: PullRequestListInput) =>
  `${LIST_SCOPE_KEY_PREFIX}${JSON.stringify(scope)}`;

function readListScope(storage: ListAnswerStorage | undefined, key: string) {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {}
  return Option.getOrElse(decodeListScope(raw), () => ({}));
}

function sweepLegacySnapshots(storage: ListAnswerStorage) {
  if (sweptStorages.has(storage)) return;
  sweptStorages.add(storage);
  const legacy: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_SNAPSHOT_KEY_PREFIX)) legacy.push(key);
  }
  for (const key of legacy) storage.removeItem(key);
}

/**
 * Keeps what a cold start can show before the host answers again. Searches, continuation pages
 * and grown pages are never shown that way, so only first-page reads are kept. Failures and
 * cursors are dropped: they describe the moment of the read, and a restored list must not
 * continue from it.
 */
export function rememberPullRequestListAnswer(
  storage: ListAnswerStorage | undefined,
  target: EnvironmentQueryTarget<PullRequestListInput>,
  answer: PullRequestListResult,
): void;
export function rememberPullRequestListAnswer(
  storage: ListAnswerStorage | undefined,
  target: EnvironmentQueryTarget<PullRequestListInput>,
  answer: PullRequestListResult,
) {
  const { input } = target;
  if (storage === undefined || input.query !== undefined || input.cursors !== undefined) return;
  if (input.limit !== undefined && input.limit > LIST_ANSWER_MAX_ENTRIES) return;
  const key = listScopeKey(input);
  try {
    sweepLegacySnapshots(storage);
    const scope = readListScope(storage, key);
    const assigned = input.projectIds === undefined ? undefined : new Set(input.projectIds);
    const retained =
      assigned === undefined
        ? []
        : (scope[target.environmentId]?.entries ?? []).filter(
            (entry) => !assigned.has(entry.projectId),
          );
    const encoded = encodeListScope({
      ...scope,
      [target.environmentId]: {
        ...answer,
        entries: [...answer.entries, ...retained].slice(0, LIST_ANSWER_MAX_ENTRIES),
        errors: [],
        nextCursors: {},
      },
    });
    if (Option.isNone(encoded)) return;
    const index = Option.getOrElse(
      decodeListScopeIndex(storage.getItem(LIST_SCOPE_INDEX_KEY)),
      () => [],
    );
    const kept = [key, ...index.filter((held) => held !== key)];
    for (const evicted of kept.slice(LIST_SCOPE_MAX_KEPT)) storage.removeItem(evicted);
    storage.setItem(key, encoded.value);
    storage.setItem(LIST_SCOPE_INDEX_KEY, JSON.stringify(kept.slice(0, LIST_SCOPE_MAX_KEPT)));
  } catch {}
}

/**
 * The kept answers for these reads, merged the way live answers are. An environment without a
 * kept answer is left out rather than failing the restore: one whose projects were all assigned
 * to another environment was never asked, and its pull requests are in that environment's answer.
 */
export function restorePullRequestList(
  storage: ListAnswerStorage | undefined,
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
): MergedPullRequestList | null;
export function restorePullRequestList(
  storage: ListAnswerStorage | undefined,
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
) {
  const scopes = new Map<string, Record<string, PullRequestListResult>>();
  const answers: Array<readonly [EnvironmentId, PullRequestListResult]> = [];
  for (const target of targets) {
    const key = listScopeKey(target.input);
    const scope = scopes.get(key) ?? readListScope(storage, key);
    scopes.set(key, scope);
    const answer = scope[target.environmentId];
    if (answer !== undefined) answers.push([target.environmentId, answer]);
  }
  const merged = mergePullRequestLists(answers);
  if (merged === null) return null satisfies MergedPullRequestList | null;
  const seen = new Set<string>();
  const entries = merged.entries.filter((entry) => {
    const key = `${entry.host}:${entry.repository}#${entry.number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...merged, entries } satisfies MergedPullRequestList | null;
}

export function restoredPullRequestList(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
) {
  return restorePullRequestList(snapshotStorage(), targets);
}

const filesViewedAnswerListeners = new Map<
  string,
  Set<(answer: PullRequestFilesViewedResult) => void>
>();

function filesViewedAnswerKey({ environmentId, input }: EnvironmentQueryTarget<PullRequestRef>) {
  return JSON.stringify([
    environmentId,
    input.projectId,
    input.host,
    input.expectedAccountId,
    input.allowStale,
    input.repository,
    input.number,
  ]);
}

export function subscribePullRequestFilesViewedAnswers(
  target: EnvironmentQueryTarget<PullRequestRef>,
  onAnswer: (answer: PullRequestFilesViewedResult) => void,
) {
  const key = filesViewedAnswerKey(target);
  let listeners = filesViewedAnswerListeners.get(key);
  if (listeners === undefined) filesViewedAnswerListeners.set(key, (listeners = new Set()));
  listeners.add(onAnswer);
  return () => {
    listeners.delete(onAnswer);
    if (listeners.size === 0) filesViewedAnswerListeners.delete(key);
  };
}

export const pullRequestEnvironment = createPullRequestEnvironmentAtoms(connectionAtomRuntime, {
  acceptedEdit: ({ environmentId, input }, edit, registry) =>
    Effect.map(Clock.currentTimeMillis, (observedAt) => {
      const saved = registry.get(
        savedPullRequestSummaryAtom(savedPullRequestKey(environmentId, input)),
      );
      recordObservation(registry, pullRequestSummaryKey(environmentId, input), (current) => {
        const summary = applyPullRequestSummaryEdits(
          input,
          newestPullRequestSummary(saved, observedPullRequestSummary(current)),
          [edit],
        );
        return summary === null ? current : { ...current, metadata: { summary, observedAt } };
      });
    }),
  filesViewed: (target, answer) =>
    Effect.sync(() => {
      for (const listener of filesViewedAnswerListeners.get(filesViewedAnswerKey(target)) ?? [])
        listener(answer);
    }),
  list: ({ environmentId, input }, answer, registry) =>
    Effect.map(Clock.currentTimeMillis, (observedAt) => {
      rememberPullRequestListAnswer(snapshotStorage(), { environmentId, input }, answer);
      for (const entry of answer.entries) {
        observePullRequestSummary(
          registry,
          pullRequestSummaryKey(environmentId, entry),
          pullRequestListEntryToSummary(entry),
          observedAt,
        );
      }
    }),
  detail: ({ environmentId, input }, detail, registry) =>
    Effect.map(Clock.currentTimeMillis, (at) => {
      if (input.allowStale === false) {
        writePullRequestDetailSnapshot(snapshotStorage(), environmentId, input, detail);
      }
      observePullRequestSummary(
        registry,
        pullRequestSummaryKey(environmentId, input),
        { ...detail, checksState: pullRequestChecksState(detail.checks) },
        at,
      );
    }),
  checks: ({ environmentId, input }, checks, registry) =>
    Effect.map(Clock.currentTimeMillis, (observedAt) => {
      if (checks === null) return;
      recordObservation(registry, pullRequestSummaryKey(environmentId, input), (current) =>
        observePullRequestChecks(current, {
          checksState: pullRequestChecksState(checks.checks),
          readAt: checks.observedAt,
          observedAt,
        }),
      );
    }),
  reviewGuide: ({ environmentId, input }, guide) =>
    Effect.map(Clock.currentTimeMillis, (since) => {
      if (guide.run?._tag !== "Running") return;
      useGuideRunStore.getState().watch({
        environmentId,
        reference: input,
        title: null,
        previousGuideAt: guide.guide?.generatedAt ?? null,
        previousFailedAt: null,
        since,
        answeredRunning: true,
      });
    }),
});

export const linkedPullRequestDetailAtom = createLinkedPullRequestSummaryAtomFamily(
  connectionAtomRuntime,
  pullRequestEnvironment.refreshes,
  ({ environmentId, input }, summary, registry) =>
    Effect.map(Clock.currentTimeMillis, (observedAt) =>
      observePullRequestSummary(
        registry,
        pullRequestSummaryKey(environmentId, input),
        summary,
        observedAt,
      ),
    ),
);

export function threadPullRequestLinkToSummary(link: ThreadPullRequestLink, projectId: ProjectId) {
  const updatedAt = link.snapshot?.updatedAt;
  if (link.snapshot === null || updatedAt == null) return null;
  return {
    ...link.snapshot,
    provider: (
      sourceControlClients.findByChangeRequestUrl(link.url) ?? sourceControlClients.get(undefined)
    ).kind,
    projectId,
    repository: link.repository,
    number: link.number,
    url: link.url,
    updatedAt,
  };
}

function savedPullRequestKey(
  environmentId: EnvironmentId,
  reference: Pick<PullRequestRef, "host" | "repository" | "number">,
) {
  return reference.host === undefined
    ? ""
    : `${environmentId}:${threadPullRequestKeyOf({ ...reference, host: reference.host })}`;
}

const savedPullRequestSummariesAtom = Atom.make((get) => {
  const summaries = new Map<string, PullRequestSummary>();
  for (const thread of get(environmentThreadShells.threadShellsAtom)) {
    for (const link of visibleThreadPullRequests(thread.pullRequests)) {
      const summary = threadPullRequestLinkToSummary(link, thread.projectId);
      if (summary === null) continue;
      const key = savedPullRequestKey(thread.environmentId, link);
      summaries.set(key, newestPullRequestSummary(summaries.get(key) ?? null, summary) ?? summary);
    }
  }
  return summaries;
});

const savedPullRequestSummaryAtom = Atom.family((key: string) =>
  Atom.make((get) => get(savedPullRequestSummariesAtom).get(key) ?? null).pipe(
    Atom.withEquality((previous, next) => JSON.stringify(previous) === JSON.stringify(next)),
    Atom.setIdleTTL(5 * 60_000),
  ),
);

export function observedPullRequestTitle(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  reference: PullRequestRef,
) {
  return (
    registry.get(pullRequestObservationsAtom(pullRequestSummaryKey(environmentId, reference)))
      .metadata?.summary.title ?? null
  );
}

/** The newest of every list, detail, checks and linked-summary answer and the thread's saved link. */
export function useSharedPullRequestSummary(
  environmentId: EnvironmentId | null,
  reference: PullRequestRef | null,
) {
  const key =
    environmentId === null || reference === null
      ? "none"
      : pullRequestSummaryKey(environmentId, reference);
  const observations = useAtomValue(pullRequestObservationsAtom(key));
  const edits = useAtomValue(pullRequestPendingEditsFor(environmentId, reference));
  const saved = useAtomValue(
    savedPullRequestSummaryAtom(
      environmentId === null || reference === null
        ? ""
        : savedPullRequestKey(environmentId, reference),
    ),
  );
  return applyPullRequestSummaryEdits(
    reference,
    newestPullRequestSummary(saved, observedPullRequestSummary(observations)),
    edits,
  );
}
export const pullRequestStackAtom = createPullRequestStackAtomFamily(
  connectionAtomRuntime,
  pullRequestEnvironment.refreshes,
);

export interface EnvironmentQueryTarget<Input> {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}

interface EnvironmentQueryError {
  readonly environmentId: EnvironmentId;
  readonly message: string;
}

interface MergedEnvironmentQueryView<A> {
  readonly observations: ReadonlyArray<readonly [EnvironmentId, A, number]>;
  readonly values: ReadonlyArray<readonly [EnvironmentId, A]>;
  readonly error: EnvironmentQueryError | null;
  readonly isPending: boolean;
}

const failedListObservedAt = new WeakMap<object, number>();
const isUnavailableList = Schema.is(PullRequestUnavailableError);
const isFailedList = Schema.is(PullRequestOperationError);

export function observeFailedPullRequestList(
  result: AsyncResult.Failure<PullRequestListResult, unknown>,
) {
  if (result.waiting) return undefined;
  const error = Option.getOrNull(Cause.findErrorOption(result.cause));
  if ((!isUnavailableList(error) && !isFailedList(error)) || error.listResult === undefined) {
    return undefined;
  }
  let observedAt = failedListObservedAt.get(result.cause);
  if (observedAt === undefined) {
    observedAt = Date.now();
    failedListObservedAt.set(result.cause, observedAt);
  }
  return { value: error.listResult, observedAt };
}

function createMergedEnvironmentQuery<Input, A>(
  label: string,
  atomFor: (
    target: EnvironmentQueryTarget<Input>,
  ) => Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
  observeFailure?: (
    result: AsyncResult.Failure<A, unknown>,
  ) => { readonly value: A; readonly observedAt: number } | undefined,
) {
  const family = Atom.family((key: string) =>
    Atom.make((get) => {
      const targets = JSON.parse(key) as ReadonlyArray<EnvironmentQueryTarget<Input>>;
      const values: Array<readonly [EnvironmentId, A]> = [];
      const observations: Array<readonly [EnvironmentId, A, number]> = [];
      const pendingEnvironments = new Set<EnvironmentId>();
      let error: EnvironmentQueryError | null = null;
      let isPending = false;
      for (const target of targets) {
        const result = get(atomFor(target));
        isPending ||= result.waiting;
        if (result.waiting) pendingEnvironments.add(target.environmentId);
        if (result._tag === "Failure" && error === null) {
          error = {
            environmentId: target.environmentId,
            message: formatEnvironmentQueryError(result.cause),
          };
        }
        const value = AsyncResult.getOrElse(result, () => null);
        if (value !== null) values.push([target.environmentId, value]);
        if (result._tag === "Success") {
          observations.push([target.environmentId, result.value, result.timestamp]);
        } else if (result._tag === "Failure") {
          const observation = observeFailure?.(result);
          if (observation !== undefined) {
            observations.push([target.environmentId, observation.value, observation.observedAt]);
          }
        }
      }
      return {
        values,
        error,
        isPending,
        observations: observations.filter(
          ([environmentId]) => !pendingEnvironments.has(environmentId),
        ),
      };
    }).pipe(Atom.withLabel(`${label}:${key}`)),
  );
  const empty = Atom.make<MergedEnvironmentQueryView<A>>({
    observations: [],
    values: [],
    error: null,
    isPending: false,
  }).pipe(Atom.withLabel(`${label}:empty`));
  return function useMergedQuery(targets: ReadonlyArray<EnvironmentQueryTarget<Input>>) {
    const key = JSON.stringify(targets);
    const view = useAtomValue(targets.length === 0 ? empty : family(key));
    const refresh = (override?: ReadonlyArray<EnvironmentQueryTarget<Input>>) => {
      const refreshTargets =
        override ?? (JSON.parse(key) as ReadonlyArray<EnvironmentQueryTarget<Input>>);
      for (const atom of new Set(refreshTargets.map(atomFor))) {
        appAtomRegistry.refresh(atom);
      }
    };
    return { ...view, refresh };
  };
}

const usePullRequestHostListsQuery = createMergedEnvironmentQuery(
  "web-pull-requests:host-list",
  (target: EnvironmentQueryTarget<PullRequestListInput>) =>
    pullRequestHostAnswer(pullRequestEnvironment.list(target)),
  observeFailedPullRequestList,
);

const usePullRequestListsQuery = createMergedEnvironmentQuery(
  "web-pull-requests:list",
  pullRequestEnvironment.list,
  observeFailedPullRequestList,
);

const usePullRequestStatsQuery = createMergedEnvironmentQuery(
  "web-pull-requests:list-stats",
  pullRequestEnvironment.listStats,
);

const usePullRequestFilterOptionsQuery = createMergedEnvironmentQuery(
  "web-pull-requests:filter-options",
  pullRequestEnvironment.filterOptions,
);

const usePullRequestTurnRefreshQuery = createMergedEnvironmentQuery(
  "web-pull-requests:turn-refreshes",
  ({ environmentId }: EnvironmentQueryTarget<Readonly<Record<string, never>>>) =>
    pullRequestEnvironment.refreshes({ environmentId, input: {} }),
);

export function usePullRequestTurnRefreshes(environmentIds: ReadonlyArray<EnvironmentId>) {
  return usePullRequestTurnRefreshQuery(
    environmentIds.map((environmentId) => ({ environmentId, input: {} })),
  ).values;
}

export function usePullRequestTurnRefresh(environmentId: EnvironmentId) {
  const result = useAtomValue(pullRequestEnvironment.refreshes({ environmentId, input: {} }));
  return AsyncResult.getOrElse(result, () => null);
}

export interface MergedPullRequestListView {
  readonly data: MergedPullRequestList | null;
  readonly error: EnvironmentQueryError | null;
  readonly isPending: boolean;
  readonly observations: ReadonlyArray<readonly [EnvironmentId, PullRequestListResult, number]>;
  readonly refresh: (targets?: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>) => void;
}

export function usePullRequestList(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
) {
  const query = usePullRequestListsQuery(targets);
  const data = mergePullRequestLists(query.values);
  return {
    data,
    error: query.error,
    isPending: query.isPending,
    observations: query.observations,
    refresh: query.refresh,
  };
}

export function usePullRequestHostList(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
) {
  const query = usePullRequestHostListsQuery(targets);
  const data = mergePullRequestLists(query.values);
  return {
    data,
    error: query.error,
    isPending: query.isPending,
    observations: query.observations,
    refresh: query.refresh,
  };
}

export function usePullRequestListStats(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListStatsInput>>,
) {
  const query = usePullRequestStatsQuery(targets);
  const stats =
    query.values.length === 0
      ? null
      : query.values.flatMap(([environmentId, result]) =>
          result.stats.map((stat) => ({ ...stat, environmentId })),
        );
  return { stats, isPending: query.isPending, refresh: query.refresh };
}

export function usePullRequestFilterOptions(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestFilterOptionsInput>>,
) {
  const query = usePullRequestFilterOptionsQuery(targets);
  return {
    labels: query.values.flatMap(([, options]) => options.labels),
    authors: query.values.flatMap(([, options]) => options.authors),
    references: query.values.flatMap(([, options]) => options.references),
    error: query.error,
    isPending: query.isPending,
  };
}
