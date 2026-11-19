import {
  CommandId,
  isListedThreadLineage,
  MessageId,
  type OrchestrationV2Notification,
  type PullRequestActivity,
  type PullRequestComment,
  type PullRequestRef,
  type PullRequestThreadCommentsResult,
  type ThreadPullRequestLink,
  type ThreadPullRequestWatch,
} from "@supaterm/contracts";
import {
  normalizeThreadPullRequestKey,
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "../sourceControl/threadPullRequests.ts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  type ProviderChangeRequestWatchFingerprint,
  PullRequestProviderError,
} from "@supaterm/source-control-core/server/PullRequestProvider";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import {
  combinePullRequestWatchWakes,
  evaluatePullRequestWatch,
  PULL_REQUEST_WATCH_NO_CHECKS_MS,
  pullRequestWatchMessage,
} from "./pullRequestWatch.ts";

const SWEEP_MINUTES = 2;
const READ_FAILURE_LIMIT = 8;
const GROUP_READS = 4;
const QUIET_REREAD_MS = 10 * 60_000;
const FINGERPRINT_REREAD_MS = 30 * 60_000;

const isProviderError = Schema.is(PullRequestProviderError);

const providerFailureReason = (cause: Cause.Cause<PullRequestService.PullRequestError>) =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => null,
    onSome: (error) =>
      error._tag === "PullRequestOperationError" && isProviderError(error.cause)
        ? error.cause.reason
        : null,
  });

const logFailure =
  (message: string, fields: Record<string, unknown>) =>
  <E>(cause: Cause.Cause<E>): Effect.Effect<void> =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.interrupt
      : Effect.logWarning(message, { ...fields, cause });

interface WatchTarget {
  readonly thread: ProjectionStore.ProjectionThreadPullRequests;
  readonly link: ThreadPullRequestLink;
  readonly watch: ThreadPullRequestWatch;
}

interface WatchGroup {
  readonly key: string;
  readonly targets: ReadonlyArray<WatchTarget>;
  readonly fingerprint: string;
}

interface LastRead {
  readonly at: number;
  readonly fingerprint: string;
  readonly inFlight: boolean;
  readonly remarksComplete: boolean;
  readonly watches: ReadonlySet<string>;
  readonly status: string | null;
  readonly remarks: string | null;
}

interface ReadPlan {
  readonly detail: boolean;
  readonly activity: boolean;
}

interface Wake {
  readonly text: string;
  readonly notification: OrchestrationV2Notification;
  readonly includesRemarks?: boolean;
}

interface HeldWake {
  readonly groupKey: string;
  readonly target: WatchTarget;
  readonly next: ThreadPullRequestWatch | null;
  readonly endedWatch?: ThreadPullRequestWatch;
  readonly wake: Wake;
  readonly reason?: WatchEndReason;
}

const watchKey = ({ thread, watch }: WatchTarget) => `${thread.id} ${watch.startedAt}`;

type WatchEndReason =
  | "merged"
  | "closed"
  | "unreadable"
  | "comment-limit"
  | "done"
  | "subagent"
  | "stopped";

interface WatchLife {
  readonly threadId: string;
  readonly pullRequest: string;
  readonly startedAt: number;
  readonly headSha: string | null;
  readonly pushedAt: number;
  readonly longestQuietMs: number;
  readonly wakes: number;
  readonly reads: number;
}

const lifeKeyOf = (threadId: string, link: ThreadPullRequestLink, watch: ThreadPullRequestWatch) =>
  `${threadId} ${threadPullRequestKeyOf(link)} ${watch.startedAt}`;
const lifeKey = ({ thread, link, watch }: WatchTarget) => lifeKeyOf(thread.id, link, watch);

const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));

const snapshotFingerprint = ({ link }: WatchTarget) => {
  const snapshot = link.snapshot;
  return snapshot === null
    ? ""
    : [
        snapshot.state,
        snapshot.updatedAt,
        snapshot.checksState,
        snapshot.mergeability,
        snapshot.rebaseRequired,
        snapshot.reviewDecision,
        snapshot.isDraft,
      ].join(" ");
};

function planRead(
  group: WatchGroup,
  last: LastRead | undefined,
  fingerprint: ProviderChangeRequestWatchFingerprint | null,
  now: number,
): ReadPlan {
  if (last === undefined || group.targets.some((target) => !last.watches.has(watchKey(target)))) {
    return { detail: true, activity: true };
  }
  const checksDue = group.targets.some(
    ({ watch }) =>
      watch.checksPending === undefined ||
      (watch.checksAwaitedSince != null &&
        now - Date.parse(watch.checksAwaitedSince) >= PULL_REQUEST_WATCH_NO_CHECKS_MS),
  );
  if (fingerprint === null) {
    const read =
      last.inFlight ||
      !last.remarksComplete ||
      last.fingerprint !== group.fingerprint ||
      now - last.at >= QUIET_REREAD_MS;
    return { detail: read || checksDue, activity: read };
  }
  const activity =
    last.remarks !== fingerprint.remarks ||
    !last.remarksComplete ||
    now - last.at >= FINGERPRINT_REREAD_MS;
  return {
    detail:
      activity ||
      checksDue ||
      last.status !== fingerprint.status ||
      (last.inFlight && fingerprint.coversDetail !== true),
    activity,
  };
}

const checksPendingBeforeOf = ({ watch }: WatchTarget) =>
  watch.checksPending === undefined ? {} : { checksPendingBefore: watch.checksPending };

function watchesEqual(left: ThreadPullRequestWatch, right: ThreadPullRequestWatch): boolean {
  return (
    left.startedAt === right.startedAt &&
    left.headSha === right.headSha &&
    left.failedChecks.join("\n") === right.failedChecks.join("\n") &&
    left.passed === right.passed &&
    left.passedChecks.join("\n") === right.passedChecks.join("\n") &&
    (left.owedChecks ?? []).join("\n") === (right.owedChecks ?? []).join("\n") &&
    (left.awaitingApproval ?? []).join("\n") === (right.awaitingApproval ?? []).join("\n") &&
    (left.approvalAnnounced ?? false) === (right.approvalAnnounced ?? false) &&
    left.remarksThrough === right.remarksThrough &&
    left.remarkIds.join("\n") === right.remarkIds.join("\n") &&
    left.conflicting === right.conflicting &&
    left.rebaseRequired === right.rebaseRequired &&
    left.mergeQueueRemovalId === right.mergeQueueRemovalId &&
    left.wakes === right.wakes &&
    left.awaitingBaseline === right.awaitingBaseline &&
    left.checksAwaitedSince === right.checksAwaitedSince &&
    left.checksPending === right.checksPending
  );
}

export class PullRequestWatchReactor extends Context.Service<
  PullRequestWatchReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly sweep: Effect.Effect<void>;
  }
>()("supaterm/orchestration-v2/PullRequestWatchReactor") {}

/** @public */
export const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const random = yield* SecureRandom.SecureRandom;
  const bootedAt = yield* Clock.currentTimeMillis;
  const lives = new Map<string, WatchLife>();

  const lifeOf = (target: WatchTarget): WatchLife => {
    const existing = lives.get(lifeKey(target));
    if (existing !== undefined) return existing;
    const startedAt = Date.parse(target.watch.startedAt);
    const life: WatchLife = {
      threadId: target.thread.id,
      pullRequest: threadPullRequestKeyOf(target.link),
      startedAt,
      headSha: target.watch.headSha,
      pushedAt: startedAt,
      longestQuietMs: 0,
      wakes: 0,
      reads: 0,
    };
    lives.set(lifeKey(target), life);
    return life;
  };
  const woke = (target: WatchTarget) =>
    Effect.sync(() => {
      const life = lifeOf(target);
      lives.set(lifeKey(target), { ...life, wakes: life.wakes + 1 });
    });

  const reportEnd = Effect.fn("PullRequestWatchReactor.reportEnd")(function* (
    key: string,
    life: WatchLife,
    reason: WatchEndReason,
  ) {
    lives.delete(key);
    const now = yield* Clock.currentTimeMillis;
    const quietMs = now - life.pushedAt;
    yield* Effect.logInfo("pull request watch ended", {
      threadId: life.threadId,
      pullRequest: life.pullRequest,
      reason,
      minutes: minutes(now - life.startedAt),
      quietMinutes: minutes(quietMs),
      longestQuietMinutes: minutes(Math.max(life.longestQuietMs, quietMs)),
      wakes: life.wakes,
      reads: life.reads,
      partial: life.startedAt < bootedAt,
    });
  });
  const ended = (target: WatchTarget, reason: WatchEndReason) =>
    Effect.suspend(() => reportEnd(lifeKey(target), lifeOf(target), reason));

  const readFailures = new Map<string, number>();
  let currentGroups: ReadonlyArray<WatchGroup> = [];
  const passes = Semaphore.makeUnsafe(1);
  const lastReads = new Map<string, LastRead>();
  const threadTails = new Map<
    string,
    {
      readonly fetchedAt: number;
      readonly visibleThrough: number;
      readonly tails: ReadonlyMap<
        string,
        { readonly count: number; readonly comments: ReadonlyArray<PullRequestComment> }
      >;
    }
  >();

  const identityOf = (link: ThreadPullRequestLink) => ({
    host: normalizeThreadPullRequestKey(link).host,
    repository: link.repository,
    number: link.number,
  });

  const record = Effect.fn("PullRequestWatchReactor.record")(function* (
    target: WatchTarget,
    next: ThreadPullRequestWatch | null,
    wake?: Wake,
    endedWatch?: ThreadPullRequestWatch,
  ) {
    const uuid = yield* random.uuidV4();
    yield* engine.dispatch({
      type: "thread.pull-request-watch.sync",
      commandId: CommandId.make(`server:pr-watch:${target.thread.id}:${uuid}`),
      threadId: target.thread.id,
      ...identityOf(target.link),
      startedAt: target.watch.startedAt,
      watch: next,
      ...checksPendingBeforeOf(target),
      ...(endedWatch === undefined ? {} : { endedWatch }),
      ...(wake === undefined
        ? {}
        : { wake: { ...wake, messageId: MessageId.make(`message:pr-watch:${uuid}`) } }),
    });
  });

  const giveUp = (target: WatchTarget) =>
    record(target, null, {
      text: `Supaterm stopped watching pull request #${target.link.number} (${target.link.url}) because it failed to read it from the host ${READ_FAILURE_LIMIT} times in a row. Check it yourself, and call watch_pull_request only if it is still open.`,
      notification: {
        source: { kind: "monitor" },
        outcome: "failed",
        summary: `#${target.link.number}: stopped watching, could not read it`,
      },
    }).pipe(
      Effect.tap(() => woke(target)),
      Effect.catch(() => record(target, null)),
      Effect.tap(() => ended(target, "unreadable")),
    );

  const readRemarks = Effect.fn("PullRequestWatchReactor.readRemarks")(
    function* (
      key: string,
      reference: PullRequestRef,
      activity: PullRequestActivity,
      now: number,
      rereadMs: number,
    ) {
      if (activity.commentsTruncated && activity.reviewThreadsTruncated !== false) return null;

      const visibleThrough = activity.comments.reduce(
        (latest, comment) => Math.max(latest, Date.parse(comment.editedAt ?? comment.createdAt)),
        0,
      );
      const paginated = activity.reviewThreads.filter(
        (thread) => thread.nextCommentsCursor != null,
      );
      const cached = threadTails.get(key);
      const reuse =
        cached !== undefined &&
        now - cached.fetchedAt < rereadMs &&
        cached.visibleThrough === visibleThrough &&
        cached.tails.size === paginated.length &&
        paginated.every(
          (thread) => cached.tails.get(thread.id)?.count === (thread.commentCount ?? 0),
        );
      const tails = new Map<
        string,
        { count: number; comments: ReadonlyArray<PullRequestComment> }
      >();
      const remarks = [...activity.comments];
      for (const thread of paginated) {
        let cursor = thread.nextCommentsCursor ?? null;
        const count = thread.commentCount ?? 0;
        let tail = reuse ? cached.tails.get(thread.id) : undefined;
        if (tail === undefined) {
          const comments = new Map<string, PullRequestComment>();
          const cursors = new Set<string>();
          let hidden = 0;
          while (cursor !== null) {
            if (cursors.has(cursor)) return null;
            cursors.add(cursor);
            const page: PullRequestThreadCommentsResult = yield* pullRequests.threadComments({
              ...reference,
              threadId: thread.id,
              cursor,
            });
            for (const comment of page.comments) {
              comments.set(comment.id, {
                ...comment,
                kind: "review-comment",
                path: thread.path,
                reviewState: null,
              });
            }
            hidden += page.hiddenCount ?? 0;
            cursor = page.nextCursor;
          }
          if (thread.comments.length + comments.size + hidden < count) return null;
          tail = { count, comments: [...comments.values()] };
        }
        tails.set(thread.id, tail);
        remarks.push(...tail.comments);
      }
      threadTails.set(key, {
        fetchedAt: reuse ? cached.fetchedAt : now,
        visibleThrough,
        tails,
      });
      return remarks.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    Effect.catch((error) =>
      Effect.logWarning("pull request watch comment pagination failed", { error }).pipe(
        Effect.as(null),
      ),
    ),
    (effect, key) =>
      effect.pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (Exit.isFailure(exit) || exit.value === null) threadTails.delete(key);
          }),
        ),
      ),
  );

  let held: Array<HeldWake> = [];
  const hold = (wake: HeldWake) => Effect.sync(() => void held.push(wake));

  const sendOne = (item: HeldWake) =>
    record(item.target, item.next, item.wake, item.endedWatch).pipe(
      Effect.tap(() => woke(item.target)),
      Effect.tap(() => (item.reason === undefined ? Effect.void : ended(item.target, item.reason))),
      Effect.catchCause((cause) => {
        lastReads.delete(item.groupKey);
        return logFailure("pull request watch update failed", {
          threadId: item.target.thread.id,
          pullRequest: item.groupKey,
        })(cause);
      }),
    );

  const sendTogether = Effect.fn("PullRequestWatchReactor.sendTogether")(function* (
    items: readonly [HeldWake, ...ReadonlyArray<HeldWake>],
  ) {
    const [first, ...rest] = items;
    const uuid = yield* random.uuidV4();
    yield* engine.dispatch({
      type: "thread.pull-request-watch.sync",
      commandId: CommandId.make(`server:pr-watch:${first.target.thread.id}:${uuid}`),
      threadId: first.target.thread.id,
      ...identityOf(first.target.link),
      startedAt: first.target.watch.startedAt,
      watch: first.next,
      ...checksPendingBeforeOf(first.target),
      ...(first.endedWatch === undefined ? {} : { endedWatch: first.endedWatch }),
      others: rest.map((item) => ({
        ...identityOf(item.target.link),
        startedAt: item.target.watch.startedAt,
        watch: item.next,
        ...checksPendingBeforeOf(item.target),
        ...(item.endedWatch === undefined ? {} : { endedWatch: item.endedWatch }),
        ...(item.wake.includesRemarks === true ? { includesRemarks: true } : {}),
      })),
      wake: {
        ...combinePullRequestWatchWakes([first.wake, ...rest.map((item) => item.wake)]),
        ...(first.wake.includesRemarks === true ? { includesRemarks: true } : {}),
        sections: items.map(({ wake }) => ({
          text: wake.text,
          outcome: wake.notification.outcome,
          summary: wake.notification.summary,
        })),
        messageId: MessageId.make(`message:pr-watch:${uuid}`),
      },
    });
    yield* Effect.forEach(
      items,
      (item) =>
        woke(item.target).pipe(
          Effect.andThen(item.reason === undefined ? Effect.void : ended(item.target, item.reason)),
        ),
      { discard: true },
    );
  });

  const sendHeld = Effect.suspend(() => {
    const byThread = new Map<string, Array<HeldWake>>();
    for (const item of held) {
      byThread.set(item.target.thread.id, [...(byThread.get(item.target.thread.id) ?? []), item]);
    }
    held = [];
    return Effect.forEach(
      byThread.values(),
      ([first, ...rest]) =>
        rest.length === 0
          ? sendOne(first!)
          : sendTogether([first!, ...rest]).pipe(
              Effect.catchCauseIf(
                (cause) => !Cause.hasInterruptsOnly(cause),
                () => Effect.forEach([first!, ...rest], sendOne, { discard: true }),
              ),
            ),
      { discard: true },
    );
  });

  const closed = (groupKey: string, target: WatchTarget) =>
    hold({
      groupKey,
      target,
      next: null,
      wake: {
        text: `Pull request #${target.link.number} (${target.link.url}) was closed, so Supaterm stopped watching it. Call watch_pull_request if it reopens.`,
        notification: {
          source: { kind: "monitor" },
          outcome: "updated",
          summary: `#${target.link.number}: closed, stopped watching`,
        },
      },
      reason: "closed",
    });

  const endsWithoutRead = ({ thread, link }: WatchTarget): WatchEndReason | undefined =>
    link.snapshot?.state === "merged"
      ? "merged"
      : thread.doneOverride === "done" || thread.doneAt !== null
        ? "done"
        : !isListedThreadLineage(thread.lineage)
          ? "subagent"
          : undefined;

  const eachTarget = <E>(
    group: WatchGroup,
    step: (target: WatchTarget) => Effect.Effect<void, E>,
  ) =>
    Effect.forEach(group.targets, (target) =>
      step(target).pipe(
        Effect.as(true),
        Effect.catchCause((cause) => {
          lastReads.delete(group.key);
          return logFailure("pull request watch update failed", {
            threadId: target.thread.id,
            pullRequest: group.key,
          })(cause).pipe(Effect.as(false));
        }),
      ),
    ).pipe(Effect.map((landed) => landed.every(Boolean)));

  const referenceOf = (group: WatchGroup) => {
    const first = group.targets[0]!;
    return { projectId: first.thread.projectId, ...identityOf(first.link) };
  };

  const fingerprintOf = (group: WatchGroup) =>
    pullRequests.watchFingerprint(referenceOf(group)).pipe(
      Effect.catchCause(
        (cause): Effect.Effect<ProviderChangeRequestWatchFingerprint | null | "paused"> =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : providerFailureReason(cause) === "rate-limited"
              ? Effect.succeed("paused")
              : Effect.logDebug("pull request watch fingerprint failed", {
                  pullRequest: group.key,
                  cause,
                }).pipe(Effect.as(null)),
      ),
    );

  const readGroup = Effect.fn("PullRequestWatchReactor.readGroup")(function* (
    group: WatchGroup,
    fingerprint: ProviderChangeRequestWatchFingerprint | null,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const last = lastReads.get(group.key);
    const plan = planRead(group, last, fingerprint, now);
    if (!plan.detail) return;
    if (
      last === undefined ||
      group.targets.some((target) => !last.watches.has(watchKey(target))) ||
      (fingerprint !== null && last.remarks !== fingerprint.remarks)
    ) {
      threadTails.delete(group.key);
    }
    const reference = referenceOf(group);
    if (fingerprint !== null) yield* pullRequests.invalidate({ reference });
    const [detailRead, activityRead] = yield* Effect.all(
      [
        Effect.exit(pullRequests.detail({ ...reference, allowStale: false })),
        Effect.exit(
          plan.activity
            ? pullRequests.activity(reference).pipe(Effect.asSome)
            : Effect.succeed(Option.none<PullRequestActivity>()),
        ),
      ],
      { concurrency: 2 },
    );
    if (Exit.isFailure(detailRead)) {
      if (Cause.hasInterruptsOnly(detailRead.cause))
        return yield* Effect.failCause(detailRead.cause);
      lastReads.delete(group.key);
      const reason = providerFailureReason(detailRead.cause);
      if (reason === "rate-limited") return;
      if (reason === "failed") {
        readFailures.delete(group.key);
        return yield* Effect.failCause(detailRead.cause);
      }
      const failures = (readFailures.get(group.key) ?? 0) + 1;
      readFailures.set(group.key, failures);
      if (failures >= READ_FAILURE_LIMIT && (yield* eachTarget(group, giveUp))) {
        readFailures.delete(group.key);
      }
      return yield* Effect.failCause(detailRead.cause);
    }
    readFailures.delete(group.key);
    const detail = detailRead.value;
    for (const target of group.targets) {
      const life = lifeOf(target);
      const headSha = detail.headSha ?? life.headSha;
      const pushed = life.headSha !== null && headSha !== life.headSha;
      lives.set(lifeKey(target), {
        ...life,
        headSha,
        reads: life.reads + 1,
        ...(pushed
          ? { pushedAt: now, longestQuietMs: Math.max(life.longestQuietMs, now - life.pushedAt) }
          : {}),
      });
    }
    if (detail.state !== "open") {
      lastReads.delete(group.key);
      return yield* eachTarget(group, (target) =>
        detail.state === "closed"
          ? closed(group.key, target)
          : record(target, null).pipe(Effect.tap(() => ended(target, "merged"))),
      );
    }

    if (Exit.isFailure(activityRead)) {
      threadTails.delete(group.key);
      if (providerFailureReason(activityRead.cause) !== "rate-limited") {
        yield* logFailure("pull request watch activity read failed", { pullRequest: group.key })(
          activityRead.cause,
        );
      }
    }
    const activity = Exit.isSuccess(activityRead)
      ? activityRead.value
      : Option.none<PullRequestActivity>();

    const remarks = Option.isSome(activity)
      ? yield* readRemarks(
          group.key,
          reference,
          activity.value,
          now,
          fingerprint === null ? QUIET_REREAD_MS : FINGERPRINT_REREAD_MS,
        )
      : null;
    lastReads.set(group.key, {
      at:
        plan.activity || last === undefined
          ? (threadTails.get(group.key)?.fetchedAt ?? now)
          : last.at,
      fingerprint: group.fingerprint,
      inFlight:
        detail.mergeability === "unknown" ||
        detail.checks.some((check) => check.status === "pending"),
      remarksComplete: plan.activity ? remarks !== null : (last?.remarksComplete ?? false),
      watches: new Set(group.targets.map(watchKey)),
      status: fingerprint?.status ?? null,
      remarks: fingerprint?.remarks ?? null,
    });
    yield* eachTarget(group, (target) => {
      const report = evaluatePullRequestWatch(target.watch, detail, remarks, now);
      if (report.changes.length > 0) {
        const wake = {
          ...pullRequestWatchMessage({
            number: target.link.number,
            url: target.link.url,
            baseBranch: detail.baseBranch,
            headSha: report.next.headSha,
            report,
          }),
          includesRemarks: report.changes.some((change) => change.kind === "remarks"),
        };

        return hold(
          report.exhausted
            ? {
                groupKey: group.key,
                target,
                next: null,
                endedWatch: report.next,
                wake,
                reason: "comment-limit",
              }
            : { groupKey: group.key, target, next: report.next, wake },
        );
      }
      return watchesEqual(report.next, target.watch) ? Effect.void : record(target, report.next);
    });
  });

  const pass = Effect.fnUntraced(function* (changed: string | undefined) {
    held = [];
    const threads = yield* projections.getThreadsWithPullRequests();
    const targets = threads.flatMap((thread) =>
      visibleThreadPullRequests(thread.pullRequests ?? []).flatMap((link) =>
        link.watch === undefined ||
        (changed !== undefined && threadPullRequestKeyOf(link) !== changed)
          ? []
          : [{ thread, link, watch: link.watch }],
      ),
    );
    if (changed === undefined) {
      const present = new Set(targets.map(lifeKey));
      const mergedWatches = new Set(
        threads.flatMap((thread) =>
          visibleThreadPullRequests(thread.pullRequests ?? []).flatMap((link) =>
            link.snapshot?.state === "merged" && link.endedWatch !== undefined
              ? [lifeKey({ thread, link, watch: link.endedWatch })]
              : [],
          ),
        ),
      );
      yield* Effect.forEach(
        [...lives].filter(([key]) => !present.has(key)),
        ([key, life]) => reportEnd(key, life, mergedWatches.has(key) ? "merged" : "stopped"),
        { discard: true },
      );
    }
    for (const target of targets) lifeOf(target);
    const byPullRequest = new Map<string, Array<WatchTarget>>();
    const ending: Array<readonly [WatchTarget, WatchEndReason]> = [];
    for (const target of targets) {
      const reason = endsWithoutRead(target);
      if (reason !== undefined) {
        ending.push([target, reason]);
        continue;
      }
      const key = `${target.thread.projectId} ${threadPullRequestKeyOf(target.link)}`;
      byPullRequest.set(key, [...(byPullRequest.get(key) ?? []), target]);
    }
    const groups = [...byPullRequest].map(([key, members]): WatchGroup => ({
      key,
      targets: members,
      fingerprint: [...new Set(members.map(snapshotFingerprint))].toSorted().join("\n"),
    }));
    if (changed === undefined) {
      currentGroups = groups;
      for (const cache of [readFailures, lastReads, threadTails]) {
        for (const key of cache.keys()) if (!byPullRequest.has(key)) cache.delete(key);
      }
    }
    yield* Effect.forEach(
      ending,
      ([target, reason]) =>
        record(target, null).pipe(
          Effect.tap(() => ended(target, reason)),
          Effect.catchCause(
            logFailure("pull request watch stop failed", {
              threadId: target.thread.id,
              pullRequest: threadPullRequestKeyOf(target.link),
            }),
          ),
        ),
      { discard: true },
    );
    const reads = yield* Semaphore.make(GROUP_READS);
    yield* Effect.forEach(
      groups,
      (group) =>
        (changed === undefined
          ? Effect.void
          : pullRequests.invalidate({ reference: referenceOf(group) })
        ).pipe(
          Effect.andThen(fingerprintOf(group)),
          Effect.tap((fingerprint) => {
            const last = lastReads.get(group.key);
            return changed !== undefined &&
              fingerprint !== null &&
              fingerprint !== "paused" &&
              (last === undefined ||
                last.status !== fingerprint.status ||
                last.remarks !== fingerprint.remarks)
              ? pullRequests.invalidate({ reference: referenceOf(group) }, { notifyReaders: true })
              : Effect.void;
          }),
          Effect.flatMap((fingerprint) =>
            fingerprint === "paused"
              ? Effect.void
              : reads.withPermit(
                  readGroup(group, fingerprint).pipe(
                    Effect.catchCause(
                      logFailure("pull request watch check failed", { pullRequest: group.key }),
                    ),
                  ),
                ),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    );
    yield* sendHeld;
  }, passes.withPermit);

  const sweep = pass(undefined).pipe(
    Effect.catchCause(logFailure("pull request watch sweep failed", {})),
    Effect.withSpan("PullRequestWatchReactor.sweep"),
  );

  const pullRequestOf = (group: WatchGroup) => threadPullRequestKeyOf(group.targets[0]!.link);

  const readOnChange = (pullRequest: string) =>
    pass(pullRequest).pipe(
      Effect.catchCause(logFailure("pull request watch change read failed", { pullRequest })),
      Effect.withSpan("PullRequestWatchReactor.readOnChange"),
    );

  const start: PullRequestWatchReactor["Service"]["start"] = Effect.fn(
    "PullRequestWatchReactor.start",
  )(function* () {
    const feeds = yield* FiberMap.make<string>();
    const follow = Effect.gen(function* () {
      const wanted = new Map(currentGroups.map((group) => [pullRequestOf(group), group]));
      const stale = Array.from(feeds, ([pullRequest]) => pullRequest).filter(
        (pullRequest) => !wanted.has(pullRequest),
      );
      yield* Effect.forEach(stale, (pullRequest) => FiberMap.remove(feeds, pullRequest), {
        discard: true,
      });
      for (const [pullRequest, group] of wanted) {
        yield* FiberMap.run(feeds, pullRequest, { onlyIfMissing: true })(
          pullRequests.changes(referenceOf(group)).pipe(
            Stream.buffer({ capacity: 1, strategy: "sliding" }),
            Stream.runForEach(() => readOnChange(pullRequest)),
          ),
        );
      }
    });
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) => {
        if (event.type !== "thread.pull-request-synced") return Effect.void;
        const unread = visibleThreadPullRequests(event.payload.pullRequests ?? []).flatMap(
          (link) =>
            link.watch === undefined || lives.has(lifeKeyOf(event.threadId, link, link.watch))
              ? []
              : [threadPullRequestKeyOf(link)],
        );
        return Effect.forEach(new Set(unread), readOnChange, { discard: true });
      }).pipe(Effect.catchCause(logFailure("pull request watch event stream failed", {}))),
    );
    yield* forkParked(
      sweep.pipe(
        Effect.andThen(follow),
        Effect.repeat(Schedule.spaced(`${SWEEP_MINUTES} minutes`)),
        Effect.asVoid,
      ),
    );
  });

  return { start, sweep } satisfies PullRequestWatchReactor["Service"];
});

export const layer = Layer.effect(PullRequestWatchReactor, make);
