import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import {
  type AtomCommand,
  type AtomCommandResult,
  runAtomCommand,
} from "@supaterm/client-runtime/state/runtime";
import { deriveThreadTitleSeed } from "@supaterm/client-runtime/operations";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
} from "@supaterm/contracts";
import { buildTemporaryWorktreeBranchName } from "@supaterm/shared/git";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { createDebugLogger } from "../lib/debugLog";
import { buildProjectThreadStartTurnInput } from "../lib/projectThreadStartTurn";
import { serializeComposerMessageForServer, uploadedComposerContext } from "../lib/composerContext";
import { randomHex } from "../lib/uuid";
import {
  describeUnavailableModelSelection,
  isModelSelectionUnavailable,
} from "../lib/modelOptions";
import { appAtomRegistry } from "./atom-registry";
import { recordPendingThreadCreationOutcome } from "./pending-thread-creation";
import { prepareQueuedThreadCreation } from "./queued-thread-creation";
import { fetchVcsRefs } from "./vcs";
import { serverEnvironment } from "./server";
import { gitEnvironment } from "./git";
import { readEnvironmentScope } from "./session";
import {
  resolveThreadOutboxFailureAction,
  resolveQueuedThreadSettings,
  shouldRetryThreadOutboxDelivery,
  type QueuedThreadCreation,
  type QueuedThreadMessage,
  type ThreadOutboxCommandStage,
  type ThreadOutboxFailureAction,
} from "./thread-outbox-model";
import { threadEnvironment } from "./threads";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import {
  prepareQueuedMessageAttachments,
  isQueuedMessagePayloadCurrent,
} from "./threadOutboxAttachments";
import {
  completeQueuedMessageDelivery,
  preserveUploadedAttachmentsForEditor,
  recoverEditedCreationAfterDelivery,
  restoreRejectedQueuedMessage,
} from "./threadOutboxRecovery";

export type QueuedDeliveryOutcome =
  | {
      readonly status:
        | "delivered"
        | "removed"
        | "recovered"
        | "deferred"
        | "abandoned"
        | "restored"
        | "retry"
        | "acknowledged";
    }
  | { readonly status: "blocked"; readonly message: QueuedThreadMessage };

type DeliveryTarget =
  | { readonly kind: "thread"; readonly thread: EnvironmentThreadShell }
  | { readonly kind: "creation"; readonly projectCwd: string };

type PreparedTarget =
  | Extract<DeliveryTarget, { readonly kind: "thread" }>
  | (Extract<DeliveryTarget, { readonly kind: "creation" }> & {
      readonly creation: QueuedThreadCreation;
    });

export async function restoreQueuedDelivery(
  message: QueuedThreadMessage,
  reason: string,
): Promise<QueuedDeliveryOutcome> {
  const status = await restoreRejectedQueuedMessage(message, reason);
  return status === "blocked" ? { status, message } : { status };
}

const threadOutboxDebug = createDebugLogger("thread-outbox");

function isRpcClientDecodeDefect(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("_tag" in error) ||
    error._tag !== "RpcClientError"
  ) {
    return false;
  }
  const reason: unknown = (error as { readonly reason?: unknown }).reason;
  return (
    typeof reason === "object" &&
    reason !== null &&
    "_tag" in reason &&
    reason._tag === "RpcClientDefect"
  );
}

function isOrdinaryThreadOutboxTransportFailure(error: unknown): boolean {
  return shouldRetryThreadOutboxDelivery(error) && !isRpcClientDecodeDefect(error);
}

function logThreadOutboxDeliveryFailure(input: {
  readonly stage: ThreadOutboxCommandStage;
  readonly error: unknown;
  readonly interrupted: boolean;
  readonly context: Record<string, unknown>;
}): ThreadOutboxFailureAction {
  const action = resolveThreadOutboxFailureAction({
    stage: input.stage,
    error: input.error,
    interrupted: input.interrupted,
  });
  const details = { ...input.context, stage: input.stage, action };
  const ordinaryTransportRetry =
    action === "retry" &&
    !isRpcClientDecodeDefect(input.error) &&
    (input.interrupted ||
      input.stage !== "settings-sync" ||
      shouldRetryThreadOutboxDelivery(input.error));
  if (ordinaryTransportRetry) {
    threadOutboxDebug.log("queued message delivery failed", details);
  } else {
    console.warn("[thread-outbox] queued message delivery failed", details);
  }
  return action;
}

function logThreadOutboxUploadFailure(queuedMessage: QueuedThreadMessage, error: unknown): void {
  const context = {
    environmentId: queuedMessage.environmentId,
    threadId: queuedMessage.threadId,
    messageId: queuedMessage.messageId,
  };
  if (isOrdinaryThreadOutboxTransportFailure(error)) {
    threadOutboxDebug.log("attachment upload failed; retrying", { ...context, error });
  } else {
    console.warn("[thread-outbox] failed to upload attachments", { ...context, error });
  }
}

function settingsCommandId(message: QueuedThreadMessage, setting: string): CommandId {
  return CommandId.make(`${message.commandId}:${setting}`);
}

function deliveredSequence(
  result: AtomCommandResult<{ readonly sequence?: number }, unknown>,
): number | undefined {
  return AsyncResult.isSuccess(result) ? result.value.sequence : undefined;
}

const runDeliveryCommand = <W, A, E>(
  command: AtomCommand<W, A, E>,
  input: W,
): Promise<AtomCommandResult<A, E>> =>
  runAtomCommand(appAtomRegistry, command, input, { reportFailure: false });

function reportCommandFailure(
  queuedMessage: QueuedThreadMessage,
  commandResult: AtomCommandResult<unknown, unknown>,
  stage: ThreadOutboxCommandStage,
): { readonly action: "retry" | "restore"; readonly message: string } | null {
  if (!AsyncResult.isFailure(commandResult)) {
    return null;
  }
  const error = Cause.squash(commandResult.cause);
  const action = logThreadOutboxDeliveryFailure({
    stage,
    error,
    interrupted: Cause.hasInterruptsOnly(commandResult.cause),
    context: {
      environmentId: queuedMessage.environmentId,
      threadId: queuedMessage.threadId,
      messageId: queuedMessage.messageId,
      cause: commandResult.cause,
    },
  });
  return {
    action,
    message: error instanceof Error ? error.message : "The message could not be sent.",
  };
}

export async function deliverQueuedMessage(
  initialMessage: QueuedThreadMessage,
  target: DeliveryTarget,
): Promise<QueuedDeliveryOutcome> {
  const hasAccess = () =>
    readEnvironmentScope(initialMessage.environmentId, AuthOrchestrationOperateScope);
  if (!hasAccess()) return { status: "deferred" };
  let queuedMessage = initialMessage;
  let destination: PreparedTarget;
  if (target.kind === "creation") {
    let workspaceResult;
    try {
      workspaceResult = await prepareQueuedThreadCreation(
        initialMessage,
        target.projectCwd,
        (input) => runDeliveryCommand(fetchVcsRefs, input),
      );
    } catch (error) {
      threadOutboxDebug.log("could not persist the queued task's base branch; retrying", {
        environmentId: initialMessage.environmentId,
        messageId: initialMessage.messageId,
        error,
      });
      return { status: "retry" };
    }
    const failure = reportCommandFailure(initialMessage, workspaceResult, "branch-resolution");
    if (failure)
      return failure.action === "retry"
        ? { status: "retry" }
        : restoreQueuedDelivery(initialMessage, failure.message);
    if (!AsyncResult.isSuccess(workspaceResult) || workspaceResult.value === null)
      return { status: "abandoned" };
    queuedMessage = workspaceResult.value.message;
    destination = { ...target, creation: workspaceResult.value.creation };
  } else {
    destination = target;
  }
  const config = appAtomRegistry.get(
    serverEnvironment.configValueAtom(queuedMessage.environmentId),
  );
  if (!config) return { status: "retry" };
  const projectId =
    destination.kind === "thread" ? destination.thread.projectId : destination.creation.projectId;
  const defaults =
    destination.kind === "thread"
      ? destination.thread
      : queuedMessage.modelSelection === undefined
        ? null
        : {
            modelSelection: queuedMessage.modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          };
  if (defaults === null) return { status: "retry" };
  const settings = resolveQueuedThreadSettings(queuedMessage, defaults, config.providers);
  if (isModelSelectionUnavailable(config, settings.modelSelection, projectId)) {
    const { title, detail } = describeUnavailableModelSelection(
      config,
      settings.modelSelection,
      projectId,
    );
    return restoreQueuedDelivery(queuedMessage, `${title}. ${detail}`);
  }
  if (destination.kind === "thread") {
    if (settings.runtimeMode !== destination.thread.runtimeMode) {
      if (!hasAccess()) return { status: "deferred" };
      const result = await runDeliveryCommand(threadEnvironment.setRuntimeMode, {
        environmentId: queuedMessage.environmentId,
        input: {
          commandId: settingsCommandId(queuedMessage, "runtime-mode"),
          threadId: queuedMessage.threadId,
          runtimeMode: settings.runtimeMode,
          createdAt: queuedMessage.createdAt,
        },
      });
      if (reportCommandFailure(queuedMessage, result, "settings-sync")) return { status: "retry" };
    }
    if (settings.interactionMode !== destination.thread.interactionMode) {
      if (!hasAccess()) return { status: "deferred" };
      const result = await runDeliveryCommand(threadEnvironment.setInteractionMode, {
        environmentId: queuedMessage.environmentId,
        input: {
          commandId: settingsCommandId(queuedMessage, "interaction-mode"),
          threadId: queuedMessage.threadId,
          interactionMode: settings.interactionMode,
          createdAt: queuedMessage.createdAt,
        },
      });
      if (reportCommandFailure(queuedMessage, result, "settings-sync")) return { status: "retry" };
    }
  }
  if (!hasAccess()) return { status: "deferred" };
  let preparedResult;
  try {
    preparedResult = await prepareQueuedMessageAttachments(queuedMessage);
    if (preparedResult.status === "abandoned") return { status: "abandoned" };
    if (appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId]) {
      await preserveUploadedAttachmentsForEditor(queuedMessage, preparedResult.persistedMessage);
      return { status: "deferred" };
    }
  } catch (error) {
    if (!hasAccess()) return { status: "deferred" };
    logThreadOutboxUploadFailure(queuedMessage, error);
    return shouldRetryThreadOutboxDelivery(error)
      ? { status: "retry" }
      : restoreQueuedDelivery(
          queuedMessage,
          error instanceof Error ? error.message : "An attachment could not upload.",
        );
  }
  const { prepared, persistedMessage, deliveryRevision } = preparedResult;
  if (!isQueuedMessagePayloadCurrent(persistedMessage, deliveryRevision))
    return { status: "abandoned" };
  const currentConfig = appAtomRegistry.get(
    serverEnvironment.configValueAtom(queuedMessage.environmentId),
  );
  if (!currentConfig) return { status: "retry" };
  if (isModelSelectionUnavailable(currentConfig, settings.modelSelection, projectId)) {
    const { title, detail } = describeUnavailableModelSelection(
      currentConfig,
      settings.modelSelection,
      projectId,
    );
    return restoreQueuedDelivery(persistedMessage, `${title}. ${detail}`);
  }
  const sendSettings = resolveQueuedThreadSettings(
    queuedMessage,
    settings,
    currentConfig.providers,
  );
  if (!hasAccess()) return { status: "deferred" };
  let workspace = destination.kind === "creation" ? destination.creation : null;
  if (destination.kind === "creation" && workspace?.pullRequestReference) {
    const checkout = await runDeliveryCommand(gitEnvironment.preparePullRequestThread, {
      environmentId: queuedMessage.environmentId,
      input: {
        cwd: destination.projectCwd,
        reference: workspace.pullRequestReference,
        mode: "worktree",
      },
    });
    if (!isQueuedMessagePayloadCurrent(persistedMessage, deliveryRevision) || !hasAccess())
      return { status: "deferred" };
    const failure = reportCommandFailure(queuedMessage, checkout, "start-turn");
    if (failure)
      return failure.action === "retry"
        ? { status: "retry" }
        : restoreQueuedDelivery(persistedMessage, failure.message);
    if (!AsyncResult.isSuccess(checkout)) return { status: "retry" };
    if (!checkout.value.worktreePath || !checkout.value.isOnPullRequestHead) {
      const { shortLabel } = (
        sourceControlClients.findByChangeRequestUrl(workspace.pullRequestReference) ??
        sourceControlClients.get(undefined)
      ).changeRequest;
      return restoreQueuedDelivery(
        persistedMessage,
        `The ${shortLabel} worktree has local changes and could not update to the ${shortLabel} head. Resolve them before trying again.`,
      );
    }
    workspace = {
      ...workspace,
      workspaceMode: "local",
      branch: checkout.value.branch,
      worktreePath: checkout.value.worktreePath,
      startFromOrigin: false,
    };
  }
  const input =
    destination.kind === "creation" && workspace !== null
      ? buildProjectThreadStartTurnInput({
          projectId: destination.creation.projectId,
          projectCwd: destination.projectCwd,
          threadId: queuedMessage.threadId,
          commandId: queuedMessage.commandId,
          messageId: queuedMessage.messageId,
          createdAt: queuedMessage.createdAt,
          titleText: queuedMessage.text,
          ...serializeComposerMessageForServer(
            queuedMessage.text.trim(),
            uploadedComposerContext(
              queuedMessage.context,
              queuedMessage.attachments,
              prepared.attachments,
            ),
          ),
          uploadedAttachments: prepared.attachments,
          modelSelection: sendSettings.modelSelection,
          runtimeMode: sendSettings.runtimeMode,
          interactionMode: sendSettings.interactionMode,
          workspaceMode: workspace.workspaceMode,
          branch: workspace.branch,
          worktreePath: workspace.worktreePath,
          startFromOrigin: workspace.startFromOrigin ?? false,
          worktreeBranchName: buildTemporaryWorktreeBranchName(randomHex),
        })
      : {
          commandId: queuedMessage.commandId,
          creationSource: "mobile" as const,
          threadId: queuedMessage.threadId,
          message: {
            messageId: queuedMessage.messageId,
            role: "user" as const,
            ...serializeComposerMessageForServer(
              queuedMessage.text,
              uploadedComposerContext(
                queuedMessage.context,
                queuedMessage.attachments,
                prepared.attachments,
              ),
            ),
            attachments: prepared.attachments,
          },
          modelSelection: sendSettings.modelSelection,
          titleSeed: deriveThreadTitleSeed({
            text: queuedMessage.text,
            attachments: queuedMessage.attachments,
          }),
          runtimeMode: sendSettings.runtimeMode,
          interactionMode: sendSettings.interactionMode,
          createdAt: queuedMessage.createdAt,
          dispatchMode: queuedMessage.dispatchMode ?? ("start" as const),
        };
  const deliveryResult = await runDeliveryCommand(threadEnvironment.startTurn, {
    environmentId: queuedMessage.environmentId,
    input,
  });
  if (AsyncResult.isFailure(deliveryResult) && !hasAccess()) return { status: "deferred" };
  const failure = reportCommandFailure(queuedMessage, deliveryResult, "start-turn");
  if (failure)
    return failure.action === "retry"
      ? { status: "retry" }
      : restoreQueuedDelivery(persistedMessage, failure.message);
  if (destination.kind === "creation")
    recordPendingThreadCreationOutcome({ kind: "delivered", message: persistedMessage });
  const completed = await completeQueuedMessageDelivery(
    persistedMessage,
    deliveryRevision,
    deliveredSequence(deliveryResult),
  );
  if (completed === "removed") return { status: "delivered" };
  if (destination.kind === "thread") return { status: "acknowledged" };
  if (completed === "failed") return { status: "retry" };
  if (appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId])
    return { status: "deferred" };
  return { status: await recoverEditedCreationAfterDelivery(persistedMessage) };
}
