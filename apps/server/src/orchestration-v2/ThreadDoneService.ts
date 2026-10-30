import {
  backgroundWorkHoldsCompletion,
  turnItemUpdateCanEndBackgroundWork,
} from "@supaterm/shared/orchestrationV2PendingBackgroundWork";
import { resolveProjectSettings } from "@supaterm/shared/projectSettings";
import { visibleThreadPullRequests } from "@supaterm/shared/threadPullRequests";
import {
  CommandId,
  isOrchestrationV2WorkActive,
  type ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
} from "@supaterm/contracts";
import { makeDrainableWorker } from "@supaterm/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as FiberMap from "effect/FiberMap";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as GitManager from "../git/GitManager.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as ProjectStore from "./ProjectStore.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export interface DonePullRequest {
  readonly state: "open" | "closed" | "merged";
  readonly closedAt?: string | null;
  readonly mergedAt?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

function toMillis(value: DateTime.Utc | null | undefined): number | null {
  return value == null ? null : DateTime.toEpochMillis(value);
}

function latestMillis(values: ReadonlyArray<number | null>): number | null {
  let latest: number | null = null;
  for (const value of values) {
    if (value === null) continue;
    if (latest === null || value > latest) latest = value;
  }
  return latest;
}

function pullRequestMatchesProject(
  pullRequest: GitManager.GitBranchPullRequest,
  project: {
    readonly repositoryIdentity?: { readonly canonicalKey: string } | null | undefined;
  },
): boolean {
  return (
    pullRequest.repositoryKey !== null &&
    project.repositoryIdentity != null &&
    sourceControlDefinitions.canonicalRepositoryKey(pullRequest.repositoryKey) ===
      sourceControlDefinitions.canonicalRepositoryKey(project.repositoryIdentity.canonicalKey)
  );
}

type DonePullRequestLink = NonNullable<
  ProjectionStore.ProjectionDoneCandidate["pullRequests"]
>[number];

function linkTerminalAtMs(link: DonePullRequestLink): number {
  const snapshot = link.snapshot;
  const value = snapshot?.state === "merged" ? snapshot.mergedAt : snapshot?.closedAt;
  const timestamp = Date.parse(value ?? "");
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function donePullRequestLinks(
  links: ReadonlyArray<DonePullRequestLink>,
): ReadonlyArray<DonePullRequestLink> {
  return visibleThreadPullRequests(links).filter((link) => {
    if (link.snapshot === null || link.snapshot.state === "open") return true;
    const linkedAtMs = Date.parse(link.linkedAt);
    return Number.isNaN(linkedAtMs) || linkTerminalAtMs(link) >= linkedAtMs;
  });
}

/**
 * Absolute age bounds client clock skew in both directions and stops stale
 * pre-adoption data from blocking the thread forever.
 */
export function threadHasQueuedTurnStart(
  thread: Pick<
    OrchestrationV2ThreadShell,
    | "latestUserMessageAt"
    | "latestRunRequestedAt"
    | "latestRunStartedAt"
    | "latestRunCompletedAt"
    | "latestRunId"
    | "status"
  >,
  nowMs: number,
): boolean {
  const messageAtMs = toMillis(thread.latestUserMessageAt);
  if (messageAtMs === null || thread.status === "failed") return false;
  const age = nowMs - messageAtMs;
  if (Number.isNaN(age) || Math.abs(age) > QUEUED_TURN_START_GRACE_MS) return false;
  if (thread.latestRunId === null) return true;
  return [
    toMillis(thread.latestRunRequestedAt),
    toMillis(thread.latestRunStartedAt),
    toMillis(thread.latestRunCompletedAt),
  ].every((value) => value === null || value < messageAtMs);
}

/**
 * A merged or closed pull request marks the thread done unless the user wrote to
 * it afterwards. Runs that background work, a PR watch, or another agent
 * started do not count, so they cannot hold a merged thread open.
 */
function pullRequestMarksDone(
  thread: Pick<
    ProjectionStore.ProjectionDoneCandidate,
    "createdAt" | "latestUserAuthoredMessageAt"
  >,
  pullRequest: DonePullRequest,
  autoMarkDoneOnMerge: boolean,
): boolean {
  if (pullRequest.state !== "closed" && (pullRequest.state !== "merged" || !autoMarkDoneOnMerge)) {
    return false;
  }
  const terminalAt = pullRequest.state === "merged" ? pullRequest.mergedAt : pullRequest.closedAt;
  if (terminalAt == null) return false;
  const userAnchorMs = latestMillis([
    toMillis(thread.createdAt),
    toMillis(thread.latestUserAuthoredMessageAt),
  ]);
  if (userAnchorMs === null) return false;
  const pullRequestAtMs = Date.parse(terminalAt);
  if (Number.isNaN(pullRequestAtMs)) return false;
  return pullRequestAtMs >= userAnchorMs;
}

export function isAutoMarkDoneCandidate(
  thread: Omit<ProjectionStore.ProjectionDoneCandidate, "latestUserAuthoredMessageAt">,
  nowMs: number,
): boolean {
  if (thread.archivedAt !== null || thread.doneOverride !== null) return false;
  if (thread.pinnedAt != null || thread.autoMarkDoneDisabledAt != null) return false;
  // Blocked-on-you work must never park behind a done override.
  if (thread.pendingRuntimeRequest !== null) return false;
  if ((thread.pendingGuestMessageCount ?? 0) > 0) return false;
  if (thread.activityRunStatus != null) return false;
  if (backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])) return false;
  if (threadHasQueuedTurnStart(thread, nowMs)) return false;

  return !isSnoozed(thread, nowMs);
}

export function isSnoozed(
  thread: Pick<
    ProjectionStore.ProjectionDoneCandidate,
    | "snoozedUntil"
    | "snoozedAt"
    | "latestRunCompletedAt"
    | "status"
    | "pendingRuntimeRequest"
    | "pendingGuestMessageCount"
  >,
  nowMs: number,
): boolean {
  const snoozedUntilMs = toMillis(thread.snoozedUntil);
  if (snoozedUntilMs === null || snoozedUntilMs <= nowMs) return false;
  if (thread.pendingRuntimeRequest !== null) return false;
  if ((thread.pendingGuestMessageCount ?? 0) > 0) return false;
  const snoozedAtMs = toMillis(thread.snoozedAt);
  const completedAtMs = toMillis(thread.latestRunCompletedAt);
  const wokeOnError =
    thread.status === "failed" &&
    (snoozedAtMs === null || (completedAtMs !== null && completedAtMs > snoozedAtMs));

  return !wokeOnError;
}

export function resolveAutoMarkDoneAt(input: {
  readonly thread: ProjectionStore.ProjectionDoneCandidate;
  readonly pullRequest: DonePullRequest | null;
  readonly nowMs: number;
  readonly autoMarkDoneAfterDays: number | null;
  readonly autoMarkDoneOnMerge: boolean;
  readonly autoMarkDoneKeepPullRequests?: boolean;
}): DateTime.Utc | null {
  const { thread } = input;
  let pullRequest = input.pullRequest;
  const links = donePullRequestLinks(thread.pullRequests ?? []);
  if (links.some((link) => link.snapshot === null)) return null;
  const hasOpenLink = links.some((link) => link.snapshot?.state === "open");
  if (hasOpenLink) {
    pullRequest = null;
  } else if (links.length > 0) {
    const latest = links.reduce((current, candidate) =>
      linkTerminalAtMs(candidate) > linkTerminalAtMs(current) ? candidate : current,
    );
    pullRequest =
      latest.snapshot === null
        ? null
        : {
            state: latest.snapshot.state,
            mergedAt: latest.snapshot.mergedAt ?? null,
            closedAt: latest.snapshot.closedAt ?? null,
          };
  }
  if (!isAutoMarkDoneCandidate(thread, input.nowMs)) return null;
  const activityAtMs =
    latestMillis([
      toMillis(thread.latestUserMessageAt),
      toMillis(thread.latestRunRequestedAt),
      toMillis(thread.latestRunStartedAt),
      toMillis(thread.latestRunCompletedAt),
    ]) ?? DateTime.toEpochMillis(thread.createdAt);
  if (
    pullRequest !== null &&
    pullRequestMarksDone(thread, pullRequest, input.autoMarkDoneOnMerge)
  ) {
    return DateTime.makeUnsafe(activityAtMs);
  }
  const hasOpenPullRequest =
    hasOpenLink ||
    (pullRequest === null
      ? thread.linkedPullRequest != null || thread.branchPullRequest != null
      : pullRequest.state === "open");
  if (input.autoMarkDoneKeepPullRequests === true && hasOpenPullRequest) return null;
  if (input.autoMarkDoneAfterDays === null) return null;
  // A passed wake timer restarts inactivity. An earlier wake can only delay completion.
  const snoozedUntilMs = toMillis(thread.snoozedUntil);
  const timerWakeAtMs =
    snoozedUntilMs !== null && snoozedUntilMs <= input.nowMs ? snoozedUntilMs : null;
  const inactivityAtMs =
    latestMillis([activityAtMs, toMillis(thread.lastSnoozeWakeAt), timerWakeAtMs]) ?? activityAtMs;
  return inactivityAtMs < input.nowMs - input.autoMarkDoneAfterDays * DAY_MS
    ? DateTime.makeUnsafe(inactivityAtMs)
    : null;
}

export class ThreadDoneServiceV2 extends Context.Service<
  ThreadDoneServiceV2,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("supaterm/orchestration-v2/ThreadDoneService/ThreadDoneServiceV2") {}

function autoMarkDoneConfigured(settings: import("@supaterm/contracts").ServerSettings): boolean {
  if (settings.sidebarAutoMarkDoneOnMerge || settings.sidebarAutoMarkDoneAfterDays !== null) {
    return true;
  }
  return Object.values(settings.projectSettingsOverrides).some(
    (entry) =>
      entry.sidebarAutoMarkDoneOnMerge === true ||
      (entry.sidebarAutoMarkDoneAfterDays !== undefined &&
        entry.sidebarAutoMarkDoneAfterDays !== null),
  );
}

/** Identity of every completion input, so unrelated settings edits do not trigger a sweep. */
/** @internal Exported for tests. */
export function autoMarkDoneSettingsKey(
  settings: import("@supaterm/contracts").ServerSettings,
): string {
  return JSON.stringify([
    settings.sidebarAutoMarkDoneOnMerge,
    settings.sidebarAutoMarkDoneAfterDays,
    settings.sidebarAutoMarkDoneKeepPullRequests,
    // Only entries that touch completion, in a stable order, so a project
    // override on an unrelated key does not queue a sweep. JSON drops
    // undefined, so inherit (absent) and never (null) need distinct marks.
    Object.entries(settings.projectSettingsOverrides)
      .filter(
        ([, entry]) =>
          entry.sidebarAutoMarkDoneOnMerge !== undefined ||
          entry.sidebarAutoMarkDoneAfterDays !== undefined ||
          entry.sidebarAutoMarkDoneKeepPullRequests !== undefined,
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([projectId, entry]) => [
        projectId,
        entry.sidebarAutoMarkDoneOnMerge ?? "inherit",
        entry.sidebarAutoMarkDoneAfterDays === undefined
          ? "inherit"
          : entry.sidebarAutoMarkDoneAfterDays,
        entry.sidebarAutoMarkDoneKeepPullRequests ?? "inherit",
      ]),
  ]);
}

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const git = yield* GitManager.GitManager;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const shellClosedThreads = new Set<ThreadId>();
  const terminals = yield* TerminalManager.TerminalManager;
  const projectScripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  // Marking a done thread done again re-emits thread.marked-done with the same doneAt,
  // so this keeps the done action to one run per completion.
  const doneActionRunAt = new Map<ThreadId, number>();

  const sweep = Effect.fn("ThreadDoneServiceV2.sweep")(function* (
    mergedPullRequest: PullRequestService.PullRequestMergeEvent | null,
    threadId?: ThreadId,
  ) {
    const settings = yield* settingsService.getSettings;
    if (!autoMarkDoneConfigured(settings)) {
      return;
    }
    const threads = yield* projections.getAutoMarkDoneCandidates(threadId);
    if (threads.length === 0) return;
    const projectShells = yield* projectStore.listShells();
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const projects = new Map(projectShells.map((project) => [project.id, project]));
    // A merge event re-sweeps every candidate, not just the threads linked to
    // the merged pull request: most threads carry no link and become done from
    // their branch lookup, which would otherwise wait for the next minute's
    // sweep on a possibly stale cached answer.
    const candidates = threads.filter((thread) => isAutoMarkDoneCandidate(thread, nowMs));

    const markThreadDone = Effect.fnUntraced(
      function* (thread: (typeof candidates)[number], pullRequest: DonePullRequest | null) {
        const currentSettings = resolveProjectSettings(
          yield* settingsService.getSettings,
          thread.projectId,
        ).settings;
        const decisionNow = yield* DateTime.now;
        const doneAt = resolveAutoMarkDoneAt({
          thread,
          pullRequest,
          nowMs: DateTime.toEpochMillis(decisionNow),
          autoMarkDoneAfterDays: currentSettings.sidebarAutoMarkDoneAfterDays,
          autoMarkDoneOnMerge: currentSettings.sidebarAutoMarkDoneOnMerge,
          autoMarkDoneKeepPullRequests: currentSettings.sidebarAutoMarkDoneKeepPullRequests,
        });
        if (doneAt === null) return thread;
        const uuid = yield* crypto.randomUUIDv4();
        yield* orchestrator.dispatch({
          type: "thread.auto-mark-done",
          commandId: CommandId.make(`server:auto-mark-done:${thread.id}:${uuid}`),
          threadId: thread.id,
          snapshotAt: thread.updatedAt,
          doneAt,
        });
        return null;
      },
      (effect, thread) =>
        effect.pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) =>
              Effect.logWarning("automatic thread completion skipped", {
                threadId: thread.id,
                cause: Cause.pretty(cause),
              }).pipe(Effect.as(null)),
          ),
        ),
    );

    const lookupCandidates = (yield* Effect.forEach(
      candidates,
      (thread) => markThreadDone(thread, null),
      { concurrency: 8 },
    ))
      .filter((thread) => thread !== null)
      .filter((thread) => visibleThreadPullRequests(thread.pullRequests ?? []).length === 0);
    const lookupCwdByThreadId = new Map<string, string>();
    yield* Effect.forEach(
      lookupCandidates,
      (thread) =>
        Effect.gen(function* () {
          const project = projects.get(thread.projectId);
          if (project === undefined || thread.branch === null) return;
          const worktreeExists =
            thread.worktreePath !== null &&
            (yield* fileSystem.exists(thread.worktreePath).pipe(Effect.orElseSucceed(() => false)));
          lookupCwdByThreadId.set(
            thread.id,
            worktreeExists && thread.worktreePath !== null
              ? thread.worktreePath
              : project.workspaceRoot,
          );
        }),
      { concurrency: 8, discard: true },
    );
    if (mergedPullRequest !== null) {
      const cwds = [...new Set(lookupCwdByThreadId.values())];
      yield* Effect.forEach(cwds, (cwd) => git.invalidateStatus(cwd), {
        concurrency: 8,
        discard: true,
      });
    }
    const lookupKey = (thread: (typeof lookupCandidates)[number]) => {
      const reference = thread.linkedPullRequest ?? thread.branchPullRequest;
      if (reference != null) {
        return JSON.stringify([
          "linked",
          reference.projectId,
          reference.repository,
          reference.number,
          lookupCwdByThreadId.get(thread.id),
          thread.branch,
        ]);
      }
      if (thread.branch === null) return JSON.stringify(["none", thread.id]);
      const cwd = lookupCwdByThreadId.get(thread.id);
      return JSON.stringify(
        cwd === undefined ? ["missing-project", thread.id] : ["branch", cwd, thread.branch],
      );
    };
    const groups = Map.groupBy(lookupCandidates, lookupKey);

    const wouldMarkDone = Effect.fnUntraced(function* (
      group: ReadonlyArray<(typeof lookupCandidates)[number]>,
      pullRequest: DonePullRequest,
    ) {
      const currentSettings = yield* settingsService.getSettings;
      const decisionNow = yield* DateTime.now;
      return group.some((thread) => {
        const { settings } = resolveProjectSettings(currentSettings, thread.projectId);
        return (
          resolveAutoMarkDoneAt({
            thread,
            pullRequest,
            nowMs: DateTime.toEpochMillis(decisionNow),
            autoMarkDoneAfterDays: settings.sidebarAutoMarkDoneAfterDays,
            autoMarkDoneOnMerge: settings.sidebarAutoMarkDoneOnMerge,
            autoMarkDoneKeepPullRequests: settings.sidebarAutoMarkDoneKeepPullRequests,
          }) !== null
        );
      });
    });

    const pullRequestFor = Effect.fnUntraced(function* (
      group: ReadonlyArray<(typeof lookupCandidates)[number]>,
    ) {
      const thread = group[0]!;
      const reference = thread.linkedPullRequest ?? thread.branchPullRequest;
      if (reference != null) {
        const matchesMerge =
          mergedPullRequest !== null &&
          reference.projectId === mergedPullRequest.projectId &&
          reference.repository.toLowerCase() === mergedPullRequest.repository.toLowerCase() &&
          reference.number === mergedPullRequest.number;
        if (!matchesMerge && !projects.has(reference.projectId)) {
          return yield* Effect.die(new Error("linked pull request project not found"));
        }
        const summary = matchesMerge
          ? ({
              state: "merged",
              closedAt: null,
              mergedAt: mergedPullRequest.mergedAt,
            } satisfies DonePullRequest)
          : yield* pullRequests.summary(
              {
                projectId: reference.projectId,
                repository: reference.repository,
                number: reference.number,
              },
              { recoverTransientFailure: false },
            );
        const terminal = {
          state: summary.state,
          closedAt: summary.closedAt ?? null,
          mergedAt: summary.mergedAt ?? null,
        } satisfies DonePullRequest;
        const cwd = lookupCwdByThreadId.get(thread.id);
        if (summary.state !== "open" && thread.branch !== null && cwd !== undefined) {
          // Recheck reused branches only when this sweep would mark a thread done.
          // Eligibility that changes after this check waits for the next sweep.
          if (!(yield* wouldMarkDone(group, terminal))) return undefined;
          const current = yield* git.branchPullRequest(
            { cwd, branch: thread.branch },
            { refresh: true },
          );
          const project = projects.get(thread.projectId);
          if (
            current?.state === "open" &&
            project !== undefined &&
            pullRequestMatchesProject(current, project)
          ) {
            return current;
          }
        }
        return terminal;
      }
      if (thread.branch === null) return null;
      const cwd = lookupCwdByThreadId.get(thread.id);
      if (cwd === undefined) {
        return yield* Effect.die(new Error("thread project not found"));
      }
      const refresh = group.filter((member) => shellClosedThreads.delete(member.id)).length > 0;
      return yield* git.branchPullRequest({ cwd, branch: thread.branch }, { refresh });
    });

    yield* Effect.forEach(
      groups.values(),
      (group) =>
        Effect.gen(function* () {
          const pullRequest = yield* pullRequestFor(group);
          if (pullRequest === undefined) return;
          yield* Effect.forEach(group, (thread) => markThreadDone(thread, pullRequest), {
            discard: true,
          });
        }).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) =>
              Effect.logWarning("automatic thread completion skipped", {
                threadIds: group.map((thread) => thread.id),
                cause: Cause.pretty(cause),
              }),
          ),
        ),
      { concurrency: 8, discard: true },
    );
  });

  const runSweep = (
    mergedPullRequest: PullRequestService.PullRequestMergeEvent | null,
    threadId?: ThreadId,
  ) =>
    sweep(mergedPullRequest, threadId).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("automatic thread completion sweep failed", {
            cause: Cause.pretty(cause),
          }),
      ),
    );
  const fullSweeps = yield* makeDrainableWorker(() => runSweep(null));
  const threadSweeps = yield* FiberSet.make<void>();
  const threadSweepSlots = yield* Semaphore.make(8);
  const threadSweepStates = new Map<ThreadId, "queued" | "running" | "rerun">();
  const sweepThread = (
    threadId: ThreadId,
  ): Effect.Effect<void, Effect.Error<ReturnType<typeof runSweep>>> =>
    Effect.sync(() => threadSweepStates.set(threadId, "running")).pipe(
      Effect.andThen(runSweep(null, threadId)),
      threadSweepSlots.withPermits(1),
      Effect.andThen(
        Effect.suspend(() => {
          if (threadSweepStates.get(threadId) === "rerun") return sweepThread(threadId);
          threadSweepStates.delete(threadId);
          return Effect.void;
        }),
      ),
    );
  const enqueueThread = (threadId: ThreadId) =>
    Effect.suspend(() => {
      const state = threadSweepStates.get(threadId);
      if (state === "running") threadSweepStates.set(threadId, "rerun");
      if (state !== undefined) return Effect.void;
      threadSweepStates.set(threadId, "queued");
      return sweepThread(threadId).pipe(FiberSet.run(threadSweeps), Effect.asVoid);
    });

  const cleanUpDoneThread = Effect.fn("ThreadDoneServiceV2.cleanUpDoneThread")(
    function* (threadId: ThreadId) {
      const done = yield* projections.getThread(threadId);
      if (done.doneOverride !== "done") return;
      yield* terminals.closeIdle({ threadId });
      const worktreePath = done.worktreePath;
      if (worktreePath === null || !(yield* fileSystem.exists(worktreePath))) return;
      // Closing and the worktree check wait on I/O. A thread re-engaged
      // meanwhile is working again, so its worktree is no place for cleanup.
      const thread = yield* projections.getThread(threadId);
      if (thread.doneOverride !== "done") return;
      const doneAtMs = toMillis(thread.doneAt);
      if (doneAtMs === null || doneActionRunAt.get(threadId) === doneAtMs) return;
      const run = yield* projectScripts.runForThread({
        threadId,
        projectId: thread.projectId,
        worktreePath,
        trigger: "done",
        observeCompletion: {},
        // Terminal startup stays outside admission; only the final state check
        // and write must exclude a concurrent run command.
        withCommandWriteGuard: (writeCommand) =>
          orchestrator.withThreadCommandLock(
            threadId,
            Effect.gen(function* () {
              const current = yield* projections.getThread(threadId).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProjectSetupScriptRunner.ProjectSetupScriptOperationError({
                      threadId,
                      projectId: thread.projectId,
                      worktreePath,
                      operation: "writeCommand",
                      cause,
                    }),
                ),
              );
              if (
                current.doneOverride !== "done" ||
                toMillis(current.doneAt) !== doneAtMs ||
                current.projectId !== thread.projectId ||
                current.worktreePath !== worktreePath
              ) {
                return false;
              }
              yield* writeCommand;
              return true;
            }),
          ),
      });
      if (run.status === "skipped") return;
      doneActionRunAt.set(threadId, doneAtMs);
      if (run.status === "started" && run.completion) {
        yield* run.completion.pipe(Effect.forkDetach);
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("cleaning up a done thread failed", {
                threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
  );

  const cleanups = yield* FiberMap.make<ThreadId, void, never>();
  const cleanupSlots = yield* Semaphore.make(8);

  const processEvent = (event: OrchestrationV2DomainEvent) => {
    switch (event.type) {
      case "thread.marked-done":
        return FiberMap.run(
          cleanups,
          event.threadId,
          cleanupSlots.withPermits(1)(cleanUpDoneThread(event.threadId)),
          { onlyIfMissing: true },
        ).pipe(Effect.asVoid);
      case "thread.reopened":
      case "thread.archived":
      case "thread.deleted":
        return FiberMap.remove(cleanups, event.threadId);
      case "thread.metadata-updated":
        return event.payload.doneOverride === "done"
          ? Effect.void
          : FiberMap.remove(cleanups, event.threadId);
      case "thread.pull-request-link-updated":
      case "thread.pull-request-synced":
      case "thread.workflow-run-watch-synced":
      case "provider-session.detached":
        return enqueueThread(event.threadId);
      case "run.background-work-cancelled":
        return enqueueThread(event.threadId);
      case "subagent.updated":
        return isOrchestrationV2WorkActive(event.payload.status)
          ? Effect.void
          : enqueueThread(event.threadId);
      case "provider-thread.updated":
        return backgroundWorkHoldsCompletion(event.payload.pendingBackgroundTasks ?? [])
          ? Effect.void
          : enqueueThread(event.threadId);
      case "turn-item.updated": {
        const item = event.payload;
        if (
          item.type === "command_execution" &&
          !isOrchestrationV2WorkActive(item.status) &&
          sourceControlDefinitions.definitions.some(
            (definition) => definition.changeRequestCloseCommand?.test(item.input) === true,
          )
        )
          shellClosedThreads.add(event.threadId);
        return turnItemUpdateCanEndBackgroundWork(item)
          ? enqueueThread(event.threadId)
          : Effect.void;
      }
      case "provider-session.updated":
        return event.payload.status !== "starting" && event.payload.status !== "running"
          ? enqueueThread(event.threadId)
          : Effect.void;
      case "run.updated":
        return ["completed", "interrupted", "failed", "cancelled", "rolled_back"].includes(
          event.payload.status,
        )
          ? enqueueThread(event.threadId)
          : Effect.void;
      default:
        return Effect.void;
    }
  };

  const start: ThreadDoneServiceV2["Service"]["start"] = Effect.fn("ThreadDoneServiceV2.start")(
    function* () {
      const settingsChanges = yield* settingsService.subscribeChanges;
      const mergedPullRequests = yield* pullRequests.subscribeMerges;
      const events = orchestrator.streamDomainEvents;
      const initialSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
      let lastDoneSettings = autoMarkDoneSettingsKey(initialSettings);
      yield* forkParked(
        Effect.gen(function* () {
          yield* fullSweeps.enqueue(undefined);
          yield* fullSweeps.drain;
        }).pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.asVoid),
      );
      yield* forkParked(
        Stream.runForEach(settingsChanges, (settings) => {
          const key = autoMarkDoneSettingsKey(settings);
          if (key === lastDoneSettings) {
            return Effect.void;
          }
          lastDoneSettings = key;
          return fullSweeps.enqueue(undefined);
        }),
      );
      yield* forkParked(Stream.runForEach(mergedPullRequests, (event) => runSweep(event)));
      yield* forkParked(
        Stream.runForEach(events, processEvent).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Thread completion event stream failed", { cause }),
          ),
        ),
      );
    },
  );

  return {
    start,
    drain: Effect.all(
      [fullSweeps.drain, FiberSet.awaitEmpty(threadSweeps), FiberMap.awaitEmpty(cleanups)],
      { discard: true },
    ),
  } satisfies ThreadDoneServiceV2["Service"];
});

export const layer = Layer.effect(ThreadDoneServiceV2, make);
