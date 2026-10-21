import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  CommandId,
  EnvironmentId,
  MessageId,
  NodeId,
  ORCHESTRATION_V2_WS_METHODS,
  PlanId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  WS_METHODS,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadLaunchInput,
  type OrchestrationV2ThreadProjection,
  type ProjectMutation,
} from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import { v2Now, v2Projection, v2ThreadId } from "../state/orchestrationV2TestFixtures.ts";
import {
  archiveThread,
  cancelQueuedRun,
  createProject,
  dismissThreadUserInput,
  editQueuedRun,
  forkThreadFromRun,
  interruptThreadTurn,
  mergeThreadBack,
  promoteQueuedRun,
  reorderActiveThread,
  reorderQueuedRun,
  revertThreadCheckpoint,
  markThreadDone,
  startThreadTurn,
  reopenThread,
  updateProject,
  updateThreadMetadata,
} from "./commands.ts";

const layerTestCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const makeSupervisor = Effect.fn("TestEnvironmentCommands.makeSupervisor")(function* (input: {
  readonly commands: OrchestrationV2Command[];
  readonly projects: ProjectMutation[];
  readonly launches?: OrchestrationV2ThreadLaunchInput[];
  readonly projection?: OrchestrationV2ThreadProjection;
  readonly projectionRequests?: ThreadId[];
  readonly advertiseServerResolvedCommandContext?: boolean;
  readonly advertiseThreadStop?: boolean;
}) {
  const client = {
    [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (command: OrchestrationV2Command) =>
      Effect.sync(() => {
        input.commands.push(command);
        return { sequence: input.commands.length };
      }),
    [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: (requestInput: {
      readonly threadId: ThreadId;
    }) =>
      Effect.sync(() => {
        input.projectionRequests?.push(requestInput.threadId);
        return input.projection ?? v2Projection;
      }),
    [ORCHESTRATION_V2_WS_METHODS.launchThread]: (launchInput: OrchestrationV2ThreadLaunchInput) =>
      Effect.sync(() => {
        input.launches?.push(launchInput);
        return {
          threadId: launchInput.threadId ?? v2ThreadId,
          projection: input.projection ?? v2Projection,
          resumed: false,
        };
      }),
    [WS_METHODS.projectsMutate]: (mutation: ProjectMutation) =>
      Effect.sync(() => {
        input.projects.push(mutation);
        return {
          id: mutation.projectId,
          title: mutation.type === "project.create" ? mutation.title : "Project",
          workspaceRoot:
            mutation.type === "project.create" ? mutation.workspaceRoot : "/workspace/project",
          repositoryIdentity: null,
          faviconPath: null,
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-06-06T00:00:00.000Z",
          updatedAt: "2026-06-06T00:00:00.000Z",
          deletedAt: null,
        };
      }),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession.RpcSession = {
    client,
    initialConfig: Effect.succeed({
      environment: {
        capabilities: input.advertiseThreadStop === true ? { threadStop: true } : {},
      },
    } as never),
    configChanges: Stream.empty,
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  return EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
});

describe("V2 environment commands", () => {
  it.effect("routes projects through the event-sourced project transport", () =>
    Effect.gen(function* () {
      const projects: ProjectMutation[] = [];
      const supervisor = yield* makeSupervisor({ commands: [], projects });

      yield* createProject({
        projectId: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/workspace/project",
        createWorkspaceRootIfMissing: true,
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(projects).toEqual([
        {
          type: "project.create",
          commandId: "00000000-0000-4000-8000-000000000000",
          projectId: "project-1",
          title: "Project",
          workspaceRoot: "/workspace/project",
          createWorkspaceRootIfMissing: true,
        },
      ]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("persists and clears project presentation and environment settings", () =>
    Effect.gen(function* () {
      const projects: ProjectMutation[] = [];
      const supervisor = yield* makeSupervisor({ commands: [], projects });
      const projectId = ProjectId.make("project-1");
      const projectIcon = { kind: "emoji", emoji: "🌲" } as const;
      yield* updateProject({
        projectId,
        autoPull: true,
        projectIcon,
        faviconPath: "/workspace/project/icon.png",
        defaultThreadEnvMode: "worktree",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      yield* updateProject({
        projectId,
        autoPull: false,
        projectIcon: null,
        faviconPath: null,
        defaultThreadEnvMode: null,
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(projects).toEqual([
        {
          type: "project.update",
          commandId: "00000000-0000-4000-8000-000000000000",
          projectId,
          autoPull: true,
          projectIcon,
          faviconPath: "/workspace/project/icon.png",
          defaultThreadEnvMode: "worktree",
        },
        {
          type: "project.update",
          commandId: "00000000-0000-4000-8000-000000000000",
          projectId,
          autoPull: false,
          projectIcon: null,
          faviconPath: null,
          defaultThreadEnvMode: null,
        },
      ]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("preserves caller command ids for idempotent V2 commands", () =>
    Effect.gen(function* () {
      const commands: OrchestrationV2Command[] = [];
      const supervisor = yield* makeSupervisor({ commands, projects: [] });

      yield* archiveThread({
        commandId: CommandId.make("queued-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(commands).toEqual([
        { type: "thread.archive", commandId: "queued-command", threadId: "thread-1" },
      ]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("preserves plan implementation provenance on V2 runs", () =>
    Effect.gen(function* () {
      const commands: OrchestrationV2Command[] = [];
      const supervisor = yield* makeSupervisor({ commands, projects: [] });

      yield* startThreadTurn({
        commandId: CommandId.make("implement-plan"),
        threadId: v2ThreadId,
        message: {
          messageId: MessageId.make("message-implementation"),
          role: "user",
          text: "Implement the plan",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        titleSeed: "Implement the plan",
        sourceProposedPlan: {
          threadId: ThreadId.make("thread-plan"),
          planId: PlanId.make("plan-1"),
        },
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        type: "message.dispatch",
        commandId: "implement-plan",
        threadId: v2ThreadId,
        titleSeed: "Implement the plan",
        sourcePlanRef: { threadId: "thread-plan", planId: "plan-1" },
        deliveryIntent: "auto",
        dispatchMode: { type: "start_immediately" },
      });
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("preserves an existing worktree and branch during first-message launch", () =>
    Effect.gen(function* () {
      const launches: OrchestrationV2ThreadLaunchInput[] = [];
      const supervisor = yield* makeSupervisor({ commands: [], projects: [], launches });

      yield* startThreadTurn({
        commandId: CommandId.make("launch-existing-worktree"),
        threadId: v2ThreadId,
        message: {
          messageId: MessageId.make("message-existing-worktree"),
          role: "user",
          text: "Continue here",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        titleSeed: "Continue here",
        bootstrap: {
          createThread: {
            projectId: ProjectId.make("project-1"),
            title: "Thread",
            modelSelection: v2Projection.thread.modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: "feature",
            worktreePath: "/workspace/project-worktrees/feature",
            createdAt: "2026-06-20T00:00:00.000Z",
          },
        },
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(launches[0]).toMatchObject({
        threadId: v2ThreadId,
        title: "Continue here",
        generateTitle: true,
        workspaceStrategy: {
          type: "existing_worktree",
          worktreePath: "/workspace/project-worktrees/feature",
          branch: "feature",
        },
      });
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("provisions an origin-based worktree for an existing empty thread", () =>
    Effect.gen(function* () {
      const launches: OrchestrationV2ThreadLaunchInput[] = [];
      const supervisor = yield* makeSupervisor({ commands: [], projects: [], launches });

      yield* startThreadTurn({
        commandId: CommandId.make("launch-existing-thread-worktree"),
        threadId: v2ThreadId,
        message: {
          messageId: MessageId.make("message-existing-thread-worktree"),
          role: "user",
          text: "Move to a worktree",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        bootstrap: {
          prepareWorktree: {
            projectCwd: "/workspace/project",
            baseBranch: "main",
            branch: "feature",
            startFromOrigin: true,
          },
        },
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(launches[0]).toMatchObject({
        threadId: v2ThreadId,
        reuseExistingThread: true,
        projectId: v2Projection.thread.projectId,
        workspaceStrategy: {
          type: "worktree",
          baseRef: "main",
          branch: "feature",
          startFromOrigin: true,
        },
      });
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("uses server-resolved delivery intent without fetching the full projection", () =>
    Effect.gen(function* () {
      const commands: OrchestrationV2Command[] = [];
      const projectionRequests: ThreadId[] = [];
      const supervisor = yield* makeSupervisor({ commands, projects: [], projectionRequests });

      for (const [mode, expectedType] of [
        ["queue", "queue_after_active"],
        ["auto", "start_immediately"],
        ["steer", "start_immediately"],
        ["restart", "start_immediately"],
      ] as const) {
        yield* startThreadTurn({
          commandId: CommandId.make(`command-${mode}`),
          threadId: v2ThreadId,
          message: {
            messageId: MessageId.make(`message-${mode}`),
            role: "user",
            text: mode,
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          dispatchMode: mode,
        }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

        expect(commands.at(-1)).toMatchObject({
          type: "message.dispatch",
          dispatchMode: { type: expectedType },
          ...(mode === "queue" ? {} : { deliveryIntent: mode }),
        });
      }
      expect(projectionRequests).toEqual([]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("Stop with no run left ends the thread's pull request and workflow run watches", () =>
    Effect.gen(function* () {
      const link = {
        host: "github.com",
        repository: "supabitapp/supaterm",
        url: "https://github.com/supabitapp/supaterm/pull/7",
        source: "agent" as const,
        linkedAt: "2026-10-05T00:00:00.000Z",
        snapshot: null,
        stack: null,
      };
      const watch = {
        startedAt: "2026-10-05T00:00:00.000Z",
        headSha: null,
        failedChecks: [],
        passed: false,
        passedChecks: [],
        remarksThrough: "2026-10-05T00:00:00.000Z",
        remarkIds: [],
        conflicting: false,
        wakes: 0,
      };
      const projection: OrchestrationV2ThreadProjection = {
        ...v2Projection,
        thread: {
          ...v2Projection.thread,
          pullRequests: [
            { ...link, number: 7, watch },
            { ...link, number: 8 },
            { ...link, number: 9, source: "stack-dismissed", watch },
          ],
          workflowRunWatches: [
            {
              host: "github.com",
              repository: "supabitapp/supaterm",
              runId: 42,
              name: "CI",
              url: null,
              startedAt: "2026-10-05T00:00:00.000Z",
            },
          ],
        },
      };
      const commands: OrchestrationV2Command[] = [];
      const supervisor = yield* makeSupervisor({ commands, projects: [], projection });

      yield* interruptThreadTurn({ threadId: v2ThreadId }).pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      );

      expect(commands).toEqual([
        {
          type: "thread.pull-request.watch",
          commandId: expect.any(String),
          threadId: v2ThreadId,
          host: "github.com",
          repository: "supabitapp/supaterm",
          number: 7,
          watching: false,
        },
        {
          type: "thread.workflow-run.unwatch",
          commandId: expect.any(String),
          threadId: v2ThreadId,
          host: "github.com",
          repository: "supabitapp/supaterm",
          runId: 42,
        },
      ]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect.each([
    "waiting",
    "completed",
    "failed",
    "interrupted",
    "cancelled",
    "rolled_back",
  ] as const)("dispatches Stop for %s runs with background commands except rollback", (status) =>
    Effect.gen(function* () {
      const waitingRunId = RunId.make("run-waiting");
      const projection: OrchestrationV2ThreadProjection = {
        ...v2Projection,
        runs: [
          {
            id: waitingRunId,
            threadId: v2ThreadId,
            ordinal: 1,
            providerInstanceId: v2Projection.thread.providerInstanceId,
            modelSelection: v2Projection.thread.modelSelection,
            providerThreadId: null,
            userMessageId: MessageId.make("message-waiting"),
            rootNodeId: null,
            activeAttemptId: null,
            status,
            requestedAt: v2Now,
            startedAt: v2Now,
            completedAt: null,
            checkpointId: null,
            contextHandoffId: null,
          },
        ],
        turnItems: [
          {
            id: TurnItemId.make("background-command"),
            threadId: v2ThreadId,
            runId: waitingRunId,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 1,
            status: "running",
            title: null,
            startedAt: v2Now,
            completedAt: null,
            updatedAt: v2Now,
            type: "command_execution",
            input: "vp run dev",
          },
        ],
      };
      const commands: OrchestrationV2Command[] = [];
      const supervisor = yield* makeSupervisor({ commands, projects: [], projection });

      const result = yield* interruptThreadTurn({ threadId: v2ThreadId }).pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      );

      expect(result).toEqual({ sequence: status === "rolled_back" ? 0 : 1 });
      expect(commands).toEqual(
        status === "rolled_back"
          ? []
          : [
              {
                type: "run.interrupt",
                commandId: expect.any(String),
                threadId: v2ThreadId,
                runId: waitingRunId,
                holdQueue: true,
              },
            ],
      );
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect(
    "dispatches V2-native relationship and queue commands without compatibility shaping",
    () =>
      Effect.gen(function* () {
        const commands: OrchestrationV2Command[] = [];
        const supervisor = yield* makeSupervisor({ commands, projects: [] });
        const provide = Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          supervisor,
        );

        yield* forkThreadFromRun({
          commandId: CommandId.make("fork"),
          sourceThreadId: v2ThreadId,
          targetThreadId: ThreadId.make("thread-fork"),
          runId: RunId.make("run-1"),
        }).pipe(provide);
        yield* mergeThreadBack({
          commandId: CommandId.make("merge"),
          sourceThreadId: ThreadId.make("thread-fork"),
          targetThreadId: v2ThreadId,
          runId: RunId.make("run-2"),
        }).pipe(provide);
        yield* reorderQueuedRun({
          commandId: CommandId.make("reorder"),
          threadId: v2ThreadId,
          runId: RunId.make("run-3"),
          beforeRunId: RunId.make("run-4"),
        }).pipe(provide);
        yield* promoteQueuedRun({
          commandId: CommandId.make("promote"),
          threadId: v2ThreadId,
          queuedRunId: RunId.make("run-3"),
          targetRunId: RunId.make("run-active"),
        }).pipe(provide);
        yield* cancelQueuedRun({
          commandId: CommandId.make("cancel"),
          threadId: v2ThreadId,
          runId: RunId.make("run-3"),
        }).pipe(provide);
        yield* editQueuedRun({
          commandId: CommandId.make("edit"),
          threadId: v2ThreadId,
          runId: RunId.make("run-3"),
          text: "updated queued text",
        }).pipe(provide);
        yield* editQueuedRun({
          commandId: CommandId.make("edit-attachments"),
          threadId: v2ThreadId,
          runId: RunId.make("run-3"),
          text: "updated queued text with attachments",
          edit: {
            messageId: MessageId.make("message-3"),
            attachments: [
              {
                type: "image",
                id: "attachment-kept",
                name: "kept.png",
                mimeType: "image/png",
                sizeBytes: 64,
              },
            ],
          },
        }).pipe(provide);

        expect(commands).toMatchObject([
          { type: "thread.fork", sourcePoint: { type: "run", runId: "run-1" } },
          { type: "thread.merge_back", sourcePoint: { type: "run", runId: "run-2" } },
          { type: "queued-run.reorder", runId: "run-3", beforeRunId: "run-4" },
          {
            type: "queued-message.promote-to-steer",
            queuedRunId: "run-3",
            targetRunId: "run-active",
          },
          { type: "queued-run.cancel", runId: "run-3" },
          { type: "queued-run.edit", runId: "run-3", text: "updated queued text" },
          {
            type: "queued-run.edit",
            runId: "run-3",
            text: "updated queued text with attachments",
            attachments: [{ id: "attachment-kept" }],
          },
        ]);
        expect(commands[5]).not.toHaveProperty("attachments");
      }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("delegates model selection to the server without fetching the full projection", () =>
    Effect.gen(function* () {
      const commands: OrchestrationV2Command[] = [];
      const projectionRequests: ThreadId[] = [];
      const supervisor = yield* makeSupervisor({ commands, projects: [], projectionRequests });

      yield* updateThreadMetadata({
        commandId: CommandId.make("same-provider"),
        threadId: v2ThreadId,
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "another-model",
        },
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      yield* updateThreadMetadata({
        commandId: CommandId.make("switch-provider"),
        threadId: v2ThreadId,
        modelSelection: {
          instanceId: ProviderInstanceId.make("claude"),
          model: "claude-sonnet-4-6",
        },
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(commands).toEqual([
        {
          type: "thread.model-selection.set",
          commandId: "same-provider",
          threadId: v2ThreadId,
          modelSelection: { instanceId: "codex", model: "another-model" },
        },
        {
          type: "thread.model-selection.set",
          commandId: "switch-provider",
          threadId: v2ThreadId,
          modelSelection: { instanceId: "claude", model: "claude-sonnet-4-6" },
        },
      ]);
      expect(projectionRequests).toEqual([]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  describe("revertThreadCheckpoint", () => {
    const checkpoint = (input: {
      readonly id: string;
      readonly ordinalWithinScope: number;
      readonly appRunOrdinal: number | null;
      readonly status: OrchestrationV2ThreadProjection["checkpoints"][number]["status"];
    }): OrchestrationV2ThreadProjection["checkpoints"][number] => ({
      id: CheckpointId.make(input.id),
      threadId: v2ThreadId,
      scopeId: CheckpointScopeId.make(`${input.id}-scope`),
      runId: null,
      nodeId: NodeId.make(`${input.id}-node`),
      parentCheckpointId: null,
      ordinalWithinScope: input.ordinalWithinScope,
      appRunOrdinal: input.appRunOrdinal,
      ref: CheckpointRef.make(`refs/supaterm/${input.id}`),
      status: input.status,
      files: [],
      capturedAt: v2Now,
    });
    const threadStart = checkpoint({
      id: "thread-start",
      ordinalWithinScope: 0,
      appRunOrdinal: null,
      status: "ready",
    });
    const earlierRunOne = checkpoint({
      id: "run-1-earlier",
      ordinalWithinScope: 1,
      appRunOrdinal: 1,
      status: "ready",
    });
    const latestRunOne = checkpoint({
      id: "run-1-latest",
      ordinalWithinScope: 2,
      appRunOrdinal: 1,
      status: "ready",
    });

    it.effect.each([
      { turnCount: 0, restoreFiles: undefined, expected: threadStart },
      { turnCount: 1, restoreFiles: true, expected: latestRunOne },
      { turnCount: 1, restoreFiles: false, expected: latestRunOne },
    ])(
      "rolls back turn count $turnCount to its latest ready checkpoint",
      ({ turnCount, restoreFiles, expected }) =>
        Effect.gen(function* () {
          const commands: OrchestrationV2Command[] = [];
          const supervisor = yield* makeSupervisor({
            commands,
            projects: [],
            projection: {
              ...v2Projection,
              checkpoints: [threadStart, earlierRunOne, latestRunOne],
            },
          });

          yield* revertThreadCheckpoint({
            commandId: CommandId.make("rollback"),
            threadId: v2ThreadId,
            turnCount,
            ...(restoreFiles === undefined ? {} : { restoreFiles }),
          }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

          expect(commands).toEqual([
            {
              type: "checkpoint.rollback",
              commandId: "rollback",
              threadId: v2ThreadId,
              checkpointId: expected.id,
              scopeId: expected.scopeId,
              ...(restoreFiles === undefined ? {} : { restoreFiles }),
            },
          ]);
        }).pipe(Effect.provide(layerTestCrypto)),
    );

    it.effect.each(["missing", "error", "stale", null] as const)(
      "refuses a run checkpoint whose status is %s",
      (status) =>
        Effect.gen(function* () {
          const commands: OrchestrationV2Command[] = [];
          const supervisor = yield* makeSupervisor({
            commands,
            projects: [],
            projection: {
              ...v2Projection,
              checkpoints:
                status === null
                  ? []
                  : [checkpoint({ id: "run-1", ordinalWithinScope: 1, appRunOrdinal: 1, status })],
            },
          });

          const error = yield* revertThreadCheckpoint({
            commandId: CommandId.make("rollback"),
            threadId: v2ThreadId,
            turnCount: 1,
          }).pipe(
            Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
            Effect.flip,
          );

          expect(error).toMatchObject({
            _tag: "OrchestrationV2CheckpointUnavailableError",
            target: "run ordinal 1",
          });
          expect(commands).toEqual([]);
        }).pipe(Effect.provide(layerTestCrypto)),
    );
  });

  it.effect("dispatches settle and reopen commands without timestamps", () =>
    Effect.gen(function* () {
      const dispatched: OrchestrationV2Command[] = [];
      const supervisor = yield* makeSupervisor({ commands: dispatched, projects: [] });

      yield* markThreadDone({
        commandId: CommandId.make("settle-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      yield* reopenThread({
        commandId: CommandId.make("reopen-command"),
        threadId: ThreadId.make("thread-1"),
        reason: "user",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.mark-done",
          commandId: "settle-command",
          threadId: "thread-1",
        },
        {
          type: "thread.reopen",
          commandId: "reopen-command",
          threadId: "thread-1",
          reason: "user",
        },
      ]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("sends an active order key without changing activity timestamps", () =>
    Effect.gen(function* () {
      const dispatched: OrchestrationV2Command[] = [];
      const supervisor = yield* makeSupervisor({ commands: dispatched, projects: [] });
      yield* reorderActiveThread({
        commandId: CommandId.make("reorder-command"),
        threadId: ThreadId.make("thread-1"),
        orderKey: "mf",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      expect(dispatched).toEqual([
        {
          type: "thread.active.reorder",
          commandId: "reorder-command",
          threadId: "thread-1",
          orderKey: "mf",
        },
      ]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("dismisses a pending user-input request", () =>
    Effect.gen(function* () {
      const commands: OrchestrationV2Command[] = [];
      const supervisor = yield* makeSupervisor({ commands, projects: [] });

      yield* dismissThreadUserInput({
        commandId: CommandId.make("dismiss-command"),
        threadId: v2ThreadId,
        requestId: RuntimeRequestId.make("request-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(commands).toEqual([
        {
          type: "thread.user-input.dismiss",
          commandId: "dismiss-command",
          threadId: v2ThreadId,
          requestId: "request-1",
        },
      ]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("dispatches an explicit idle start without fetching the full projection", () =>
    Effect.gen(function* () {
      const commands: OrchestrationV2Command[] = [];
      const projectionRequests: ThreadId[] = [];
      const supervisor = yield* makeSupervisor({
        commands,
        projects: [],
        projectionRequests,
      });

      yield* startThreadTurn({
        commandId: CommandId.make("direct-start"),
        threadId: v2ThreadId,
        message: {
          messageId: MessageId.make("direct-start-message"),
          role: "user",
          text: "continue",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        dispatchMode: "start",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(projectionRequests).toEqual([]);
      expect(commands).toMatchObject([
        {
          type: "message.dispatch",
          threadId: v2ThreadId,
          dispatchMode: { type: "start_immediately" },
        },
      ]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect(
    "a native subagent stop targets its owning run rather than holding the parent queue",
    () =>
      Effect.gen(function* () {
        const subagentId = NodeId.make("native-subagent");
        const runId = RunId.make("settled-owner-run");
        const commands: OrchestrationV2Command[] = [];
        const supervisor = yield* makeSupervisor({
          commands,
          projects: [],
          projection: {
            ...v2Projection,
            subagents: [
              {
                id: subagentId,
                threadId: v2ThreadId,
                runId,
                parentNodeId: NodeId.make("owner-node"),
                origin: "provider_native",
                createdBy: "agent",
                driver: ProviderDriverKind.make("claudeAgent"),
                providerInstanceId: ProviderInstanceId.make("claudeAgent"),
                providerThreadId: null,
                childThreadId: ThreadId.make("native-child-thread"),
                nativeTaskRef: null,
                prompt: "Work",
                title: null,
                model: null,
                result: null,
                status: "running",
                startedAt: v2Now,
                completedAt: null,
                updatedAt: v2Now,
              },
            ],
          },
        });
        yield* interruptThreadTurn({
          commandId: CommandId.make("native-stop"),
          threadId: v2ThreadId,
          subagentId,
        }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
        expect(commands).toEqual([
          {
            type: "subagent.stop",
            commandId: "native-stop",
            threadId: v2ThreadId,
            runId,
            subagentId,
          },
        ]);
      }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("stops a thread without relying on background work in the history window", () =>
    Effect.gen(function* () {
      const commands: OrchestrationV2Command[] = [];
      const projectionRequests: ThreadId[] = [];
      const supervisor = yield* makeSupervisor({
        commands,
        projects: [],
        projectionRequests,
        advertiseThreadStop: true,
      });

      const result = yield* interruptThreadTurn({
        commandId: CommandId.make("stop-outside-history-window"),
        threadId: v2ThreadId,
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(result).toEqual({ sequence: 1 });
      expect(projectionRequests).toEqual([]);
      expect(commands).toEqual([
        {
          type: "thread.stop",
          commandId: "stop-outside-history-window",
          threadId: v2ThreadId,
        },
      ]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );

  it.effect("interrupts a known run without fetching the full projection", () =>
    Effect.gen(function* () {
      const commands: OrchestrationV2Command[] = [];
      const projectionRequests: ThreadId[] = [];
      const supervisor = yield* makeSupervisor({
        commands,
        projects: [],
        projectionRequests,
        advertiseThreadStop: true,
      });

      yield* interruptThreadTurn({
        commandId: CommandId.make("direct-interrupt"),
        threadId: v2ThreadId,
        runId: RunId.make("active-run"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(projectionRequests).toEqual([]);
      expect(commands).toEqual([
        {
          type: "run.interrupt",
          commandId: "direct-interrupt",
          threadId: v2ThreadId,
          runId: "active-run",
          holdQueue: true,
        },
      ]);
    }).pipe(Effect.provide(layerTestCrypto)),
  );
});
