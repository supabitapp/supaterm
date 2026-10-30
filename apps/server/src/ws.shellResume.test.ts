import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadShell,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as ThreadManagement from "./orchestration-v2/ThreadManagementService.ts";
import * as OrchestrationEventStore from "./persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "./persistence/Sqlite.ts";
import * as ProjectEnrichment from "./project/ProjectEnrichmentService.ts";
import * as ProjectService from "./project/ProjectService.ts";
import { liveThreadShell } from "./mcp/McpToolAccess.testkit.ts";
import { insertOrchestrationEventRow } from "./persistence/orchestrationEventRows.testkit.ts";
import { subscribeOrchestrationV2Shell } from "./ws.ts";

const ReplayTestLayer = OrchestrationEventStore.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const resumeShellFixture = (
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({ ...liveThreadShell(ThreadId.make(id)), ...overrides });

const resumeProjectFixture = (id: string): OrchestrationProjectShell => ({
  id: ProjectId.make(id),
  title: id,
  workspaceRoot: `/tmp/${id}`,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-05T00:00:00.000Z",
  updatedAt: "2026-01-05T00:00:00.000Z",
});

const insertResumeEvent = (aggregateKind: "project" | "thread", streamId: string) =>
  insertOrchestrationEventRow({ aggregateKind, streamId });

// Collect a resume through the real handler and event store; shells and projects are fixtures.
const collectShellResume = Effect.fnUntraced(function* (input: {
  readonly afterSequence?: number;
  readonly requestCompletionMarker?: boolean;
  readonly shells?: ReadonlyMap<string, OrchestrationV2ThreadShell | null>;
  readonly projects?: ReadonlyMap<string, OrchestrationProjectShell>;
  readonly snapshotThreads?: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly take?: number;
  readonly subagentThreadIds?: ReadonlyArray<ThreadId>;
  readonly afterSynchronized?: Effect.Effect<void>;
  readonly onThreadRead?: (threadId: ThreadId) => void;
}) {
  const updates = yield* PubSub.unbounded<never>();
  const items = yield* subscribeOrchestrationV2Shell({
    ...(input.afterSequence === undefined ? {} : { afterSequence: input.afterSequence }),
    ...(input.requestCompletionMarker === false ? {} : { requestCompletionMarker: true }),
  }).pipe(
    Effect.flatMap((stream) =>
      stream.pipe(
        Stream.tap((item) =>
          item.kind === "synchronized" ? (input.afterSynchronized ?? Effect.void) : Effect.void,
        ),
        input.take === undefined
          ? Stream.takeUntil((item) => item.kind === "synchronized")
          : Stream.take(input.take),
        Stream.runCollect,
      ),
    ),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          listActiveSubagentThreadIds: () => Effect.succeed(input.subagentThreadIds ?? []),
          listActiveShellIndex: () => Effect.succeed([]),
          getThreadShell: (threadId) =>
            Effect.sync(() => {
              input.onThreadRead?.(threadId);
              return input.shells?.get(threadId) ?? null;
            }),
          readShellSnapshot: () =>
            Effect.succeed(
              Effect.succeed({
                schemaVersion: 1,
                snapshotSequence: 0,
                threads: input.snapshotThreads ?? [],
                archivedThreads: [],
              }),
            ),
        }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          listShells: () => Effect.succeed(Array.from(input.projects?.values() ?? [])),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getShell: (projectId) =>
            Effect.succeed(Option.fromUndefinedOr(input.projects?.get(projectId))),
        }),
        Layer.mock(ProjectEnrichment.ProjectEnrichmentService)({
          subscribeChanges: PubSub.subscribe(updates),
          getAvailable: () =>
            Effect.succeed({
              repositoryIdentity: null,
              faviconPath: null,
              repositoryIdentityResolved: false,
            }),
        }),
      ),
    ),
    Effect.scoped,
  );
  return Array.from(items);
});

const describeResumeItem = (item: OrchestrationV2ShellStreamItem) => {
  switch (item.kind) {
    case "thread.updated":
      return `${item.kind} ${item.thread.id} @${item.sequence}`;
    case "thread.removed":
      return `${item.kind} ${item.threadId} @${item.sequence}`;
    case "project.updated":
      return `${item.kind} ${item.project.id} @${item.sequence}`;
    case "project.removed":
      return `${item.kind} ${item.projectId} @${item.sequence}`;
    case "snapshot":
      return `snapshot ${item.snapshot.threads.length} threads @${item.snapshot.snapshotSequence}`;
    default:
      return item.kind;
  }
};

it.live("resumed shells filter a child transcript flood before projecting parent updates", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const events = yield* OrchestrationEventStore.OrchestrationEventStore;
    const child = ThreadId.make("thread:flood-child");
    const parent = ThreadId.make("thread:flood-parent");
    const cursor = yield* insertResumeEvent("thread", parent);
    const reads: ThreadId[] = [];
    const publish = Effect.gen(function* () {
      const insertChildMessage = (index: number) =>
        insertOrchestrationEventRow({
          aggregateKind: "thread",
          streamId: child,
          eventType: "message.updated",
          payload: JSON.stringify({
            id: `flood-message-${index}`,
            threadId: child,
            runId: null,
            nodeId: null,
            createdBy: "user",
            creationSource: "web",
            role: "user",
            text: `${index}`,
            attachments: [],
            streaming: false,
            createdAt: "2026-01-05T00:00:00.000Z",
            updatedAt: "2026-01-05T00:00:00.000Z",
          }),
        });
      for (let index = 0; index < 1100; index++) yield* insertChildMessage(index);
      const throughSequence = yield* insertResumeEvent("thread", parent);
      yield* insertChildMessage(1100);
      const stored = yield* events
        .readApplicationEvents({ afterSequence: cursor, throughSequence })
        .pipe(Stream.runCollect);
      assert.equal(stored.length, 1101);
      assert.equal(stored.at(-1)?.sequence, throughSequence);
      yield* events.publishCommitted(stored);
    }).pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.orDie);
    const items = yield* collectShellResume({
      afterSequence: cursor,
      subagentThreadIds: [child],
      shells: new Map([[parent, resumeShellFixture(parent)]]),
      take: 2,
      afterSynchronized: publish,
      onThreadRead: (id) => reads.push(id),
    });
    assert.deepEqual(
      items.map((item) => item.kind),
      ["synchronized", "thread.updated"],
    );
    assert.deepEqual(reads, [parent]);
  }).pipe(Effect.provide(Layer.fresh(ReplayTestLayer))),
);

it.live("shell resume past a thousand events sends each changed thread once", () =>
  Effect.gen(function* () {
    const cursor = yield* insertResumeEvent("thread", "thread:quiet");
    const latest = new Map<string, number>();
    for (let index = 0; index < 1_500; index++) {
      const threadId = `thread:busy-${index % 3}`;
      latest.set(threadId, yield* insertResumeEvent("thread", threadId));
    }
    latest.set("project:edited", yield* insertResumeEvent("project", "project:edited"));
    const shells = new Map(
      ["thread:busy-0", "thread:busy-1", "thread:busy-2", "thread:quiet"].map(
        (id) => [id, resumeShellFixture(id)] as const,
      ),
    );
    const projects = new Map([["project:edited", resumeProjectFixture("project:edited")]]);

    const items = yield* collectShellResume({ afterSequence: cursor, shells, projects });

    assert.deepEqual(items.map(describeResumeItem), [
      `thread.updated thread:busy-0 @${latest.get("thread:busy-0")}`,
      `thread.updated thread:busy-1 @${latest.get("thread:busy-1")}`,
      `thread.updated thread:busy-2 @${latest.get("thread:busy-2")}`,
      `project.updated project:edited @${latest.get("project:edited")}`,
      "synchronized",
    ]);
  }).pipe(Effect.provide(Layer.fresh(ReplayTestLayer))),
);

it.live("shell resume removes deleted and archived threads and deleted projects", () =>
  Effect.gen(function* () {
    const cursor = yield* insertResumeEvent("thread", "thread:kept");
    const kept = yield* insertResumeEvent("thread", "thread:kept");
    const deleted = yield* insertResumeEvent("thread", "thread:deleted");
    const archived = yield* insertResumeEvent("thread", "thread:archived");
    const project = yield* insertResumeEvent("project", "project:deleted");
    const shells = new Map<string, OrchestrationV2ThreadShell | null>([
      ["thread:kept", resumeShellFixture("thread:kept")],
      ["thread:deleted", null],
      [
        "thread:archived",
        resumeShellFixture("thread:archived", {
          archivedAt: DateTime.makeUnsafe("2026-01-05T00:00:00.000Z"),
        }),
      ],
    ]);

    const items = yield* collectShellResume({ afterSequence: cursor, shells });

    assert.deepEqual(items.map(describeResumeItem), [
      `thread.updated thread:kept @${kept}`,
      `thread.removed thread:deleted @${deleted}`,
      `thread.removed thread:archived @${archived}`,
      `project.removed project:deleted @${project}`,
      "synchronized",
    ]);
  }).pipe(Effect.provide(Layer.fresh(ReplayTestLayer))),
);

it.live("shell resume refetches projects whose events this build does not know", () =>
  Effect.gen(function* () {
    const cursor = yield* insertResumeEvent("thread", "thread:only");
    const future = yield* insertOrchestrationEventRow({
      aggregateKind: "project",
      streamId: "project:future",
      eventType: "project.from-a-newer-build",
      payload: '{"unreadable":true}',
    });
    const projects = new Map([["project:future", resumeProjectFixture("project:future")]]);

    const items = yield* collectShellResume({ afterSequence: cursor, projects });

    assert.deepEqual(items.map(describeResumeItem), [
      `project.updated project:future @${future}`,
      "synchronized",
    ]);
  }).pipe(Effect.provide(Layer.fresh(ReplayTestLayer))),
);

it.live("shell resume past a million sequences sends a snapshot without scanning them", () =>
  Effect.gen(function* () {
    const cursor = yield* insertResumeEvent("thread", "thread:only");
    const head = yield* insertOrchestrationEventRow({
      aggregateKind: "thread",
      streamId: "thread:only",
      sequence: cursor + 1_000_001,
    });

    const items = yield* collectShellResume({
      afterSequence: cursor,
      snapshotThreads: [resumeShellFixture("thread:only")],
    });

    assert.deepEqual(items.map(describeResumeItem), [
      `snapshot 1 threads @${head}`,
      "synchronized",
    ]);
  }).pipe(Effect.provide(Layer.fresh(ReplayTestLayer))),
);

it.live("shell resume sends a snapshot once more than 500 threads changed", () =>
  Effect.gen(function* () {
    const cursor = yield* insertResumeEvent("thread", "thread:before");
    for (let index = 0; index < 501; index++) {
      yield* insertResumeEvent("thread", `thread:many-${index}`);
    }
    const head = yield* insertResumeEvent("thread", "thread:many-0");
    const snapshotThreads = [resumeShellFixture("thread:many-0")];

    const overCap = yield* collectShellResume({ afterSequence: cursor, snapshotThreads });
    assert.deepEqual(overCap.map(describeResumeItem), [
      `snapshot 1 threads @${head}`,
      "synchronized",
    ]);

    const shells = new Map([["thread:many-0", resumeShellFixture("thread:many-0")]]);
    const underCap = yield* collectShellResume({ afterSequence: head - 1, shells });
    assert.deepEqual(underCap.map(describeResumeItem), [
      `thread.updated thread:many-0 @${head}`,
      "synchronized",
    ]);
  }).pipe(Effect.provide(Layer.fresh(ReplayTestLayer))),
);

it.live("shell resume from a cursor ahead of this database sends a snapshot", () =>
  Effect.gen(function* () {
    const head = yield* insertResumeEvent("thread", "thread:only");
    const items = yield* collectShellResume({
      afterSequence: head + 10,
      snapshotThreads: [resumeShellFixture("thread:only")],
    });
    assert.deepEqual(items.map(describeResumeItem), [
      `snapshot 1 threads @${head}`,
      "synchronized",
    ]);
  }).pipe(Effect.provide(Layer.fresh(ReplayTestLayer))),
);

it.live("shell resume at the head only confirms synchronization", () =>
  Effect.gen(function* () {
    const head = yield* insertResumeEvent("thread", "thread:only");
    const items = yield* collectShellResume({ afterSequence: head });
    assert.deepEqual(items.map(describeResumeItem), ["synchronized"]);
  }).pipe(Effect.provide(Layer.fresh(ReplayTestLayer))),
);

it.live("shell resume without a completion marker sends the same changes to older clients", () =>
  Effect.gen(function* () {
    const cursor = yield* insertResumeEvent("thread", "thread:a");
    for (let index = 0; index < 1_200; index++) {
      yield* insertResumeEvent("thread", index % 2 === 0 ? "thread:a" : "thread:b");
    }
    const shells = new Map(
      ["thread:a", "thread:b"].map((id) => [id, resumeShellFixture(id)] as const),
    );
    const items = yield* collectShellResume({
      afterSequence: cursor,
      requestCompletionMarker: false,
      shells,
      take: 2,
    });
    assert.deepEqual(
      items.map((item) => item.kind),
      ["thread.updated", "thread.updated"],
    );
  }).pipe(Effect.provide(Layer.fresh(ReplayTestLayer))),
);
