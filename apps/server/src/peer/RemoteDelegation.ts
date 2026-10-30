import {
  CommandId,
  type EnvironmentId,
  NodeId,
  OrchestratorMcpFailure,
  OrchestratorMcpThreadInterruptResult,
  type OrchestratorMcpDelegateTaskInput,
  type OrchestratorMcpTaskCancelResult,
  type OrchestratorMcpThreadTimelineItem,
  type OrchestrationV2RemoteTaskChild,
  type OrchestrationV2Subagent,
  type ProjectId,
  type ProviderInstanceId,
  ProviderDriverKind,
  type RunId,
  type ThreadId,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Hex from "effect/encoding/Hex";
import * as KeyedLock from "@supaterm/shared/KeyedLock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as Tool from "effect/ai/Tool";

import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { ProjectToolkit } from "../mcp/toolkits/project/tools.ts";
import {
  resolveInteractionMode,
  resolveRuntimeMode,
  taskPrompt,
} from "../mcp/delegatedTaskModes.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { forkParked } from "../serverActivation.ts";
import * as PeerForwarding from "./PeerForwarding.ts";
import * as PeerLinks from "./PeerLinks.ts";
import * as PeerMcpClient from "./PeerMcpClient.ts";
import * as RemoteLaunchJournal from "./RemoteLaunchJournal.ts";

const FOLLOW_WAIT_MS = 10 * 60 * 1_000;
const FOLLOW_MAX_BACKOFF = Duration.minutes(5);
export const FollowRetrySchedule = Context.Reference<Schedule.Schedule<unknown>>(
  "supaterm/peer/RemoteDelegation/FollowRetrySchedule",
  {
    defaultValue: () =>
      Schedule.exponential(Duration.seconds(2)).pipe(
        Schedule.modifyDelay(({ duration }) =>
          Effect.succeed(Duration.min(duration, FOLLOW_MAX_BACKOFF)),
        ),
      ),
  },
);

type ThreadScope = McpInvocationContext.McpThreadInvocationScope;

export class RemoteDelegation extends Context.Service<
  RemoteDelegation,
  {
    readonly delegate: (
      scope: ThreadScope,
      input: OrchestratorMcpDelegateTaskInput & {
        readonly target: NonNullable<OrchestratorMcpDelegateTaskInput["target"]> & {
          readonly environmentId: EnvironmentId;
        };
      },
    ) => Effect.Effect<{ readonly taskId: NodeId }, OrchestratorMcpFailure>;
    readonly cancel: (
      scope: ThreadScope,
      task: OrchestrationV2Subagent,
      input: {
        readonly reason?: string | undefined;
        readonly clientRequestId?: string | undefined;
      },
    ) => Effect.Effect<OrchestratorMcpTaskCancelResult, OrchestratorMcpFailure>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("supaterm/peer/RemoteDelegation") {}

const isOrchestratorMcpFailure = Schema.is(OrchestratorMcpFailure);

const isModeRefusal = (error: OrchestratorMcpFailure) =>
  error.code === "runtime_mode_escalation_denied" ||
  error.code === "interaction_mode_escalation_denied";

const isFinal = (error: OrchestratorMcpFailure) =>
  error.code === "capability_denied" ||
  error.code === "thread_not_found" ||
  error.code === "run_not_found";

const make = Effect.gen(function* () {
  const followRetry = yield* FollowRetrySchedule;
  const forwarding = yield* PeerForwarding.PeerForwarding;
  const links = yield* PeerLinks.PeerLinks;
  const peers = yield* PeerMcpClient.PeerMcpClient;
  const journal = yield* RemoteLaunchJournal.RemoteLaunchJournal;
  const launchLocks = yield* KeyedLock.make<string>();
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const repositoryIdentities = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const crypto = yield* Crypto.Crypto;
  const hereId = yield* ServerEnvironment.ServerEnvironment.pipe(
    Effect.flatMap((environment) => environment.getEnvironmentId),
  );
  const followers = yield* Scope.Scope;

  const readTask = (parentThreadId: ThreadId, taskId: NodeId) =>
    threads
      .getThreadRecords(parentThreadId, ["subagents"], { subagentIds: [taskId] })
      .pipe(Effect.map(({ thread, subagents }) => ({ thread, task: subagents[0] })));

  const resolveRemoteProject = Effect.fn("RemoteDelegation.resolveRemoteProject")(function* (
    scope: ThreadScope,
    environmentId: EnvironmentId,
    parentProjectId: ProjectId,
    requested: ProjectId | undefined,
  ) {
    if (requested !== undefined) return requested;
    const here = yield* projects.getById(parentProjectId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined),
    );
    const key =
      here === undefined
        ? undefined
        : (yield* repositoryIdentities.resolve(here.workspaceRoot))?.canonicalKey;
    if (key === undefined) {
      return yield* new OrchestratorMcpFailure({
        code: "target_required",
        message: "Pass target.projectId: this thread's project has no repository to match there.",
      });
    }
    const matches: Array<{ readonly id: ProjectId; readonly title: string }> = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const listed: Tool.Success<typeof ProjectToolkit.tools.supaterm_project_list> =
        yield* forwarding.call(scope, ProjectToolkit.tools.supaterm_project_list, environmentId, {
          cursor,
          limit: 100,
        });
      matches.push(
        ...listed.projects.filter((project) => project.repositoryIdentity?.canonicalKey === key),
      );
      cursor = listed.nextCursor;
    }
    if (matches.length === 1) return matches[0]!.id;
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message:
        matches.length === 0
          ? `No project there has this repository (${key}). Pass target.projectId; supaterm_project_list with this environmentId lists them. To bring the repository there, use supaterm_project_clone and then supaterm_project_create with this environmentId.`
          : `Several projects there have this repository: ${matches.map((project) => `${project.title} (${project.id})`).join(", ")}. Pass target.projectId.`,
    });
  });

  const delegate: RemoteDelegation["Service"]["delegate"] = Effect.fn("RemoteDelegation.delegate")(
    function* (scope, input) {
      if (!(yield* links.enabled)) return yield* PeerForwarding.linkedEnvironmentsOff;
      const parent = yield* threads.getThreadRecords(scope.thread.threadId, ["runs"]).pipe(
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "thread_not_found",
              message: "The calling thread was not found.",
            }),
        ),
      );
      const parentRun = parent.runs
        .filter(ThreadManagement.isActiveRun)
        .toSorted((left, right) => right.ordinal - left.ordinal)[0];
      if (
        parentRun === undefined ||
        parentRun.rootNodeId === null ||
        parentRun.providerInstanceId !== scope.thread.providerInstanceId
      ) {
        return yield* new OrchestratorMcpFailure({
          code: "parent_not_active",
          message: "Delegated tasks require an active run owned by this MCP provider session.",
        });
      }
      if (parent.thread.linkOrigin !== undefined && parent.thread.linkOrigin !== null) {
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message:
            "Work started through a link cannot delegate through another environment's links.",
        });
      }
      const parentNodeId = parentRun.rootNodeId;
      const { target } = input;
      if (input.isolation === "worktree") {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message:
            'A task in a linked environment runs in that project\'s checkout; isolation "worktree" is not supported there. Omit isolation, or use supaterm_thread_launch with environmentId and a worktree workspaceStrategy.',
        });
      }
      const inherited = parent.thread.modelSelection;
      const instanceId = target.providerInstanceId ?? inherited.instanceId;
      const model =
        target.model ?? (instanceId === inherited.instanceId ? inherited.model : undefined);
      if (model === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "target_required",
          message: "Pass target.model from orchestrator_capabilities with this environmentId.",
        });
      }
      const options =
        target.options ??
        (instanceId === inherited.instanceId && model === inherited.model
          ? inherited.options
          : undefined);
      const runtimeMode =
        input.runtimeMode === undefined || input.runtimeMode === "inherit"
          ? undefined
          : yield* resolveRuntimeMode(parent.thread.runtimeMode, input.runtimeMode);
      const interactionMode =
        input.interactionMode === undefined || input.interactionMode === "inherit"
          ? undefined
          : yield* resolveInteractionMode(parent.thread.interactionMode, input.interactionMode);
      const projectId = yield* resolveRemoteProject(
        scope,
        target.environmentId,
        parent.thread.projectId,
        target.projectId,
      );
      const key = input.clientRequestId ?? (yield* crypto.randomUUIDv4().pipe(Effect.orDie));
      const task = taskPrompt(input);
      const route = yield* links
        .resolve(target.environmentId)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
          ),
        );
      const id = Hex.encode(
        yield* crypto
          .digest("SHA-256", new TextEncoder().encode(`${scope.requestNamespace}\n${key}`))
          .pipe(Effect.orDie),
      );
      const remoteKey = Hex.encode(
        yield* crypto
          .digest(
            "SHA-256",
            new TextEncoder().encode(
              `${scope.requestNamespace}\ndelegate:${scope.thread.threadId}:${key}`,
            ),
          )
          .pipe(Effect.orDie),
      );
      const intent = yield* journal
        .prepare({
          id,
          label: route.link.label,
          parentThreadId: scope.thread.threadId,
          parentRunId: parentRun.id,
          parentNodeId,
          providerInstanceId: scope.thread.providerInstanceId,
          requestNamespace: scope.requestNamespace,
          targetEnvironmentId: target.environmentId,
          credentialId: route.credentialId,
          runtimeMode: parent.thread.runtimeMode,
          interactionMode: parent.thread.interactionMode,
          launch: {
            projectId,
            title: input.title ?? parent.thread.title,
            modelSelection: { instanceId, model, ...(options === undefined ? {} : { options }) },
            ...(runtimeMode === undefined ? {} : { runtimeMode }),
            ...(interactionMode === undefined ? {} : { interactionMode }),
            message: task,
            clientRequestId: `fwd:${remoteKey}`,
            delegatedFrom: {
              environmentId: hereId,
              threadId: parent.thread.id,
              title: parent.thread.title,
            },
          },
          task,
          ...(input.title === undefined ? {} : { title: input.title }),
          completionWake: input.mode === "wait" ? "settled_only" : "always",
          remote: null,
          taskId: null,
        })
        .pipe(
          Effect.mapError(
            () =>
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: "Unable to persist the remote launch before starting it.",
              }),
          ),
        );
      return yield* reconcileLaunch(intent).pipe(
        Effect.onError(() => recoverLaunch(intent).pipe(Effect.forkIn(followers), Effect.asVoid)),
      );
    },
  );

  const reconcileLaunch = Effect.fn("RemoteDelegation.reconcileLaunch")(
    (intent: RemoteLaunchJournal.RemoteLaunchIntent) =>
      launchLocks.withLock(
        intent.id,
        Effect.gen(function* () {
          intent = yield* journal.prepare(intent).pipe(
            Effect.mapError(
              () =>
                new OrchestratorMcpFailure({
                  code: "orchestration_error",
                  message: "Unable to read the remote launch recovery record.",
                }),
            ),
          );
          if (intent.taskId !== null) return { taskId: intent.taskId };
          if (intent.remote === null && !(yield* links.enabled)) {
            return yield* new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "The pending launch is waiting for Linked environments to be enabled.",
            });
          }
          const limits = {
            runtimeMode: intent.runtimeMode,
            interactionMode: intent.interactionMode,
          };
          const launched =
            intent.remote ??
            (yield* peers.call({
              environmentId: intent.targetEnvironmentId,
              credentialId: intent.credentialId,
              tool: ProjectToolkit.tools.supaterm_thread_launch.name,
              arguments: intent.launch,
              limits,
              success: ProjectToolkit.tools.supaterm_thread_launch.successSchema,
            }));
          if (intent.remote === null)
            intent = yield* journal.recordLaunch(intent, launched).pipe(
              Effect.mapError(
                () =>
                  new OrchestratorMcpFailure({
                    code: "orchestration_error",
                    message: "Unable to persist the remote launch acknowledgement.",
                  }),
              ),
            );
          const parentShell = yield* threads.getThreadShell(intent.parentThreadId).pipe(
            Effect.mapError(
              () =>
                new OrchestratorMcpFailure({
                  code: "orchestration_error",
                  message: "Unable to read the remote task parent.",
                }),
            ),
          );
          const current =
            parentShell === null
              ? Option.none()
              : yield* threads.getThreadRecords(intent.parentThreadId, ["subagents", "runs"]).pipe(
                  Effect.asSome,
                  Effect.mapError(
                    () =>
                      new OrchestratorMcpFailure({
                        code: "orchestration_error",
                        message: "Unable to read the remote task parent.",
                      }),
                  ),
                );
          const existing = Option.isSome(current)
            ? current.value.subagents.find(
                (task) =>
                  task.remoteChild?.environmentId === intent.targetEnvironmentId &&
                  task.remoteChild.threadId === launched.threadId,
              )
            : undefined;
          if (existing !== undefined) {
            yield* journal.complete(intent, existing.id);
            yield* followOne(intent.parentThreadId, existing.id).pipe(Effect.forkIn(followers));
            return { taskId: existing.id };
          }
          const active =
            Option.isSome(current) &&
            current.value.thread.deletedAt === null &&
            current.value.thread.archivedAt === null &&
            current.value.runs.some(
              (run) => run.id === intent.parentRunId && ThreadManagement.isActiveRun(run),
            );
          if (!active) {
            yield* peers.call({
              environmentId: intent.targetEnvironmentId,
              credentialId: intent.credentialId,
              tool: "supaterm_thread_interrupt",
              arguments: {
                threadId: launched.threadId,
                stop: true,
                clientRequestId: `abandoned:${intent.id}`,
              },
              limits,
              success: OrchestratorMcpThreadInterruptResult,
            });
            yield* journal.remove(intent.id);
            return yield* new OrchestratorMcpFailure({
              code: "parent_not_active",
              message:
                "The parent ended before the remote launch was recorded. Its remote work was stopped.",
            });
          }
          const recorded = yield* threads
            .dispatch({
              type: "delegated_task.remote.request",
              commandId: CommandId.make(`command:remote-delegate:${intent.id}`),
              parentThreadId: intent.parentThreadId,
              parentRunId: intent.parentRunId,
              parentNodeId: intent.parentNodeId,
              task: intent.task,
              ...(intent.title === undefined ? {} : { title: intent.title }),
              driver: ProviderDriverKind.make("remote"),
              modelSelection: launched.modelSelection,
              remoteChild: {
                environmentId: intent.targetEnvironmentId,
                threadId: launched.threadId,
                label: intent.label,
                ...(launched.runId === null ? {} : { runId: launched.runId }),
              },
              completionWake: intent.completionWake,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new OrchestratorMcpFailure({
                    code: "orchestration_error",
                    message:
                      "Unable to record the delegated task. Its launch remains queued for recovery.",
                  }),
              ),
            );
          const event = recorded.storedEvents.find(
            (stored) => stored.event.type === "subagent.updated",
          )?.event;
          const taskId =
            event?.type === "subagent.updated"
              ? event.payload.id
              : (yield* threads.getThreadRecords(intent.parentThreadId, [
                  "subagents",
                ])).subagents.find((task) => task.remoteChild?.threadId === launched.threadId)?.id;
          if (taskId === undefined)
            return yield* new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "The remote task record could not be read.",
            });
          yield* journal.complete(intent, taskId);
          yield* followOne(intent.parentThreadId, taskId).pipe(Effect.forkIn(followers));
          return { taskId };
        }).pipe(
          Effect.mapError((error) =>
            isOrchestratorMcpFailure(error)
              ? error
              : new OrchestratorMcpFailure({
                  code: "orchestration_error",
                  message: "The remote launch could not be recovered.",
                }),
          ),
        ),
      ),
  );

  const recoverLaunch = (intent: RemoteLaunchJournal.RemoteLaunchIntent) =>
    reconcileLaunch(intent).pipe(
      Effect.retry({
        schedule: followRetry,
        while: (error) => error.code !== "parent_not_active" && !isFinal(error),
      }),
      Effect.ignoreCause({ log: true }),
    );

  const complete = Effect.fn("RemoteDelegation.complete")(function* (
    parentThreadId: ThreadId,
    taskId: NodeId,
    status: "completed" | "failed" | "cancelled" | "interrupted",
    result: string,
    stoppedThere: "ran-out" | "stopped" | undefined,
    stopCount?: number,
  ) {
    const attempt = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
    yield* threads
      .dispatch({
        type: "delegated_task.remote.complete",
        commandId: CommandId.make(`command:remote-task-complete:${taskId}:${attempt}`),
        parentThreadId,
        taskId,
        status,
        result,
        ...(stoppedThere === undefined ? {} : { stoppedThere }),
        ...(stopCount === undefined ? {} : { stopCount }),
      })
      .pipe(
        Effect.catch((error) =>
          readTask(parentThreadId, taskId).pipe(
            Effect.flatMap(({ task }) => (task?.result != null ? Effect.void : Effect.fail(error))),
          ),
        ),
      );
  });

  const followScope = (
    parent: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
    remote: OrchestrationV2RemoteTaskChild,
  ): ThreadScope => ({
    environmentId: hereId,
    requestNamespace: `remote-task:${parent.threadId}`,
    thread: {
      threadId: parent.threadId,
      providerSessionId: `remote-task:${remote.threadId}`,
      providerInstanceId: parent.providerInstanceId,
    },
    client: undefined,
    capabilities: new Set(["orchestration"]),
    issuedAt: 0,
  });

  const stopThere = (
    scope: ThreadScope,
    remote: OrchestrationV2RemoteTaskChild,
    key: string,
    reason?: string,
  ) =>
    forwarding
      .interruptThread(scope, remote.environmentId, {
        threadId: remote.threadId,
        stop: true,
        ...(reason === undefined ? {} : { reason }),
        clientRequestId: `${key}:${remote.threadId}`,
      })
      .pipe(Effect.asVoid);

  const lastReply = Effect.fn("RemoteDelegation.lastReply")(function* (
    scope: ThreadScope,
    remote: OrchestrationV2RemoteTaskChild,
    runId: RunId | null,
    failed = false,
  ) {
    let reply: OrchestratorMcpThreadTimelineItem | undefined;
    let error: OrchestratorMcpThreadTimelineItem | undefined;
    let afterPosition: number | undefined;
    while (true) {
      const read = yield* forwarding.readThread(scope, remote.environmentId, {
        threadId: remote.threadId,
        view: failed ? "activity" : "messages",
        limit: 100,
        ...(afterPosition === undefined ? {} : { afterPosition }),
      });
      reply =
        read.items.findLast(
          (item) => item.type === "assistant_message" && (runId === null || item.runId === runId),
        ) ?? reply;
      if (failed) {
        error =
          read.items.findLast(
            (item) => item.type === "error" && (runId === null || item.runId === runId),
          ) ?? error;
      }
      if (!read.hasMore || read.nextPosition === null) break;
      afterPosition = read.nextPosition;
    }
    reply = error ?? reply;
    if (reply === undefined) return undefined;
    let text = reply.text ?? "";
    let textOffset = reply.textTruncated ? (reply.nextTextOffset ?? null) : null;
    while (textOffset !== null) {
      const rest = yield* forwarding.readThread(scope, remote.environmentId, {
        threadId: remote.threadId,
        itemId: reply.itemId,
        textOffset,
        maxCharsPerItem: 50_000,
      });
      const part = rest.items[0];
      if (part === undefined) break;
      text += part.text ?? "";
      textOffset = part.textTruncated ? (part.nextTextOffset ?? null) : null;
    }
    return text;
  });

  const finalReason = Effect.fn("RemoteDelegation.finalReason")(
    function* (parentThreadId: ThreadId, taskId: NodeId, error: OrchestratorMcpFailure) {
      if (isFinal(error)) return error.message;
      if (error.code !== "invalid_request") return undefined;
      const { task } = yield* readTask(parentThreadId, taskId);
      const environmentId = task?.remoteChild?.environmentId;
      if (environmentId === undefined) return error.message;
      const link = yield* links.get(environmentId);
      return Option.isSome(link) ? undefined : error.message;
    },
    Effect.orElseSucceed(() => undefined),
  );

  const noReply = "(The thread in the linked environment ended without a reply.)";

  const follow = (parentThreadId: ThreadId, taskId: NodeId): Effect.Effect<void> =>
    followOnce(parentThreadId, taskId).pipe(
      Effect.repeat({ while: (done) => !done }),
      Effect.catchTags({
        OrchestratorMcpFailure: Effect.fn("RemoteDelegation.followFailed")(function* (error) {
          const reason = yield* finalReason(parentThreadId, taskId, error);
          if (reason === undefined) return yield* error;
          const { task } = yield* readTask(parentThreadId, taskId);
          const stopCount = task?.remoteChild?.stopCount;
          yield* complete(parentThreadId, taskId, "failed", reason, "stopped", stopCount);
        }),
      }),
      Effect.retry(followRetry),
      Effect.ignoreCause({ log: true }),
    );

  const followOnce = Effect.fn("RemoteDelegation.followOnce")(function* (
    parentThreadId: ThreadId,
    taskId: NodeId,
  ) {
    const sequence = yield* threads.getThreadEventSequence(parentThreadId);
    const { thread, task } = yield* readTask(parentThreadId, taskId);
    if (task?.remoteChild === undefined) return true;
    const remote = task.remoteChild;
    const scope = followScope(
      { threadId: parentThreadId, providerInstanceId: thread.providerInstanceId },
      remote,
    );
    if (task.result !== null) {
      if (
        remote.stoppedThere === false ||
        ((task.status === "cancelled" || task.status === "interrupted") &&
          remote.stoppedThere !== true)
      ) {
        const key = remote.stopCount === undefined ? "stop" : `stop-${remote.stopCount}`;
        yield* stopThere(scope, remote, key).pipe(
          Effect.catchIf(isModeRefusal, (error) =>
            Effect.logWarning("A linked environment refused to stop a delegated task", {
              taskId,
              reason: error.message,
            }),
          ),
        );
        yield* complete(
          parentThreadId,
          taskId,
          terminalStatus(task.status),
          task.result,
          "stopped",
          remote.stopCount,
        );
        return yield* settled(parentThreadId, taskId);
      }
      return true;
    }
    const endedHere = threads
      .streamStoredEventsFrom({
        threadId: parentThreadId,
        afterSequence: sequence,
        eventType: "subagent.updated",
      })
      .pipe(
        Stream.filter(
          (stored) =>
            stored.event.type === "subagent.updated" &&
            stored.event.payload.id === taskId &&
            stored.event.payload.result !== null,
        ),
        Stream.runHead,
        Effect.flatMap((ended) =>
          Option.isSome(ended) ? Effect.succeed({ endedHere: true } as const) : Effect.never,
        ),
      );
    const waited = yield* forwarding
      .waitForThread(scope, remote.environmentId, {
        threadId: remote.threadId,
        ...(remote.runId === undefined ? {} : { runId: remote.runId }),
        timeoutMs: FOLLOW_WAIT_MS,
        untilDelegatedWorkSettled: true,
      })
      .pipe(Effect.raceFirst(endedHere));
    if ("endedHere" in waited) return false;
    if (waited.timedOut) return false;
    if (waited.runId === null) {
      const reply = yield* lastReply(scope, remote, null);
      yield* complete(
        parentThreadId,
        taskId,
        reply === undefined ? "failed" : "completed",
        reply ?? "The thread in the linked environment has no run to follow.",
        "ran-out",
      );
      return yield* settled(parentThreadId, taskId);
    }
    if (!isTerminal(waited.status)) return false;
    const resultRun = waited.resultRun ?? {
      runId: remote.runId ?? waited.runId,
      status: waited.status,
    };
    const result = yield* lastReply(scope, remote, resultRun.runId, resultRun.status === "failed");
    yield* complete(
      parentThreadId,
      taskId,
      terminalStatus(resultRun.status),
      result ?? noReply,
      "ran-out",
    );
    return yield* settled(parentThreadId, taskId);
  });

  const settled = (parentThreadId: ThreadId, taskId: NodeId) =>
    readTask(parentThreadId, taskId).pipe(
      Effect.map(({ task }) => task?.remoteChild?.stoppedThere === true),
    );

  const following = new Map<NodeId, { again: boolean }>();

  const followOne = (parentThreadId: ThreadId, taskId: NodeId) =>
    Effect.suspend(() => {
      const running = following.get(taskId);
      if (running !== undefined) {
        running.again = true;
        return Effect.void;
      }
      const state = { again: false };
      following.set(taskId, state);
      return follow(parentThreadId, taskId).pipe(
        Effect.repeat({
          while: () => {
            if (state.again) {
              state.again = false;
              return true;
            }
            following.delete(taskId);
            return false;
          },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            if (following.get(taskId) === state) following.delete(taskId);
          }),
        ),
      );
    });

  const cancel: RemoteDelegation["Service"]["cancel"] = Effect.fn("RemoteDelegation.cancel")(
    function* (scope, task, input) {
      const remote = task.remoteChild;
      if (remote === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "task_not_found",
          message: `Delegated task ${task.id} is not remote.`,
        });
      }
      const { reason } = input;
      const there = followScope(scope.thread, remote);
      const key = `cancel:${encodeURIComponent(scope.requestNamespace)}:${
        input.clientRequestId ?? (yield* crypto.randomUUIDv4().pipe(Effect.orDie))
      }`;
      if (task.result !== null) {
        yield* stopThere(there, remote, key, reason).pipe(
          Effect.andThen(
            complete(
              task.threadId,
              task.id,
              terminalStatus(task.status),
              task.result,
              "stopped",
              remote.stopCount,
            ),
          ),
          Effect.ignoreCause({ log: true }),
        );
        return {
          taskId: task.id,
          status:
            task.status === "completed" || task.status === "failed" || task.status === "interrupted"
              ? task.status
              : "cancelled",
        } satisfies OrchestratorMcpTaskCancelResult;
      }
      const unstopped = yield* stopThere(there, remote, key, reason).pipe(
        Effect.as(undefined),
        Effect.catch((error) => Effect.succeed(error.message)),
      );
      const cancelled = reason === undefined ? "Cancelled." : `Cancelled: ${reason}`;
      yield* complete(
        task.threadId,
        task.id,
        "cancelled",
        unstopped === undefined
          ? cancelled
          : `${cancelled} It could not be stopped in ${remote.label} and may still run there: ${unstopped}`,
        unstopped === undefined ? "stopped" : undefined,
        remote.stopCount,
      ).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("remote-delegation.cancel-record-failed", { taskId: task.id, cause }),
        ),
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "Unable to record the cancellation.",
            }),
        ),
      );
      return {
        taskId: task.id,
        status: "cancel_requested",
      } satisfies OrchestratorMcpTaskCancelResult;
    },
  );

  const start: RemoteDelegation["Service"]["start"] = () =>
    forkParked(
      Effect.gen(function* () {
        yield* Stream.runForEach(threads.streamDomainEvents, (event) =>
          event.type === "subagent.updated" && event.payload.remoteChild?.stoppedThere === false
            ? followOne(event.threadId, event.payload.id).pipe(Effect.forkIn(followers))
            : Effect.void,
        ).pipe(
          Effect.ignoreCause({ log: true }),
          Effect.forkIn(followers, { startImmediately: true }),
        );
        yield* Effect.gen(function* () {
          const pending = yield* journal.pending;
          yield* Effect.forEach(
            pending,
            (intent) => recoverLaunch(intent).pipe(Effect.forkIn(followers)),
            { discard: true },
          );
        }).pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("remote-delegation.recovery-read-failed", { cause }),
          ),
          Effect.retry({ schedule: followRetry }),
          Effect.forkIn(followers),
        );
        const open = yield* projections.getOpenRemoteDelegatedTasks;
        yield* Effect.forEach(
          open,
          ({ parentThreadId, taskId }) => followOne(parentThreadId, taskId),
          {
            concurrency: "unbounded",
            discard: true,
          },
        );
      }).pipe(Effect.ignoreCause({ log: true })),
    );

  return RemoteDelegation.of({ delegate, cancel, start });
});

const isTerminal = (status: string) =>
  status === "completed" ||
  status === "failed" ||
  status === "cancelled" ||
  status === "interrupted" ||
  status === "rolled_back";

const terminalStatus = (status: string): "completed" | "failed" | "cancelled" | "interrupted" =>
  status === "completed" || status === "failed" || status === "interrupted" ? status : "cancelled";

export const layer = Layer.effect(RemoteDelegation, make);
