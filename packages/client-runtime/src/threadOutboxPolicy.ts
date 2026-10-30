import { isTransportConnectionErrorMessage } from "./errors/transport.ts";
import {
  clampFileAttachmentUploadBytes,
  fileAttachmentTooLargeMessage,
} from "./state/attachments.ts";
import type { EnvironmentShellStatus } from "./state/shell.ts";

export function threadOutboxRetryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 16_000);
}

export function shouldRetryThreadOutboxDelivery(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    switch (error._tag) {
      case "OrchestrationDispatchCommandError":
      case "EnvironmentAuthorizationError":
        return false;
      case "ConnectionTransientError":
      case "RpcClientError":
      case "EnvironmentRpcUnavailableError":
      case "EnvironmentNotRegisteredError":
        return true;
    }
  }
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : typeof error === "string"
        ? error
        : null;
  return isTransportConnectionErrorMessage(message);
}

export type ThreadOutboxDeliveryAction = "wait" | "remove" | "send";

export function resolveThreadOutboxDeliveryAction(input: {
  readonly isCreation: boolean;
  readonly threadExists: boolean;
  readonly shellStatus: EnvironmentShellStatus;
  readonly environmentConnected: boolean;
  readonly threadBusy: boolean;
  /** The thread's creation was delivered but its shell has not arrived yet. */
  readonly awaitingCreatedThread: boolean;
}): ThreadOutboxDeliveryAction {
  if (input.isCreation) {
    // A pending task creates its thread on delivery. If the thread already
    // exists the creation command went through and only cleanup remains.
    if (input.threadExists) {
      return "remove";
    }
    // Wait for the shell to be live before sending: until the thread list has
    // synchronized, a previously delivered creation whose cleanup failed would
    // look missing and get re-issued, duplicating the thread.
    return input.environmentConnected && input.shellStatus === "live" ? "send" : "wait";
  }
  // A follow-up queued behind its thread's creation becomes the head as soon
  // as the creation leaves the queue, which can be before the shell lands.
  if (!input.threadExists) {
    return input.shellStatus === "live" && !input.awaitingCreatedThread ? "remove" : "wait";
  }
  return input.environmentConnected ? "send" : "wait";
}

export type ThreadOutboxDispatchStep =
  | { readonly step: "wait" }
  | { readonly step: "remove" }
  | { readonly step: "retry" }
  | { readonly step: "restore"; readonly reason: string }
  | { readonly step: "send" };

/**
 * Wait for provider and file capabilities before sending. Cleanup does not
 * need config: a creation whose thread exists, or a message whose thread is
 * gone, can still be removed while config loads.
 */
export function resolveThreadOutboxDispatchStep(input: {
  readonly deliveryAction: ThreadOutboxDeliveryAction;
  readonly fileAttachments: ReadonlyArray<{ readonly name: string; readonly sizeBytes: number }>;
  /** Null while the environment's server config has not synced yet. */
  readonly serverConfig: { readonly maxFileUploadBytes: number | undefined } | null;
}): ThreadOutboxDispatchStep {
  if (input.deliveryAction !== "send") {
    return { step: input.deliveryAction };
  }
  if (input.serverConfig === null) {
    return { step: "retry" };
  }
  if (input.fileAttachments.length === 0) {
    return { step: "send" };
  }
  const maxBytes = input.serverConfig.maxFileUploadBytes;
  if (maxBytes === undefined) {
    return { step: "restore", reason: "This server does not support file attachments." };
  }
  const effectiveMaxBytes = clampFileAttachmentUploadBytes(maxBytes);
  const oversized = input.fileAttachments.find(
    (attachment) => attachment.sizeBytes > effectiveMaxBytes,
  );
  return oversized
    ? { step: "restore", reason: fileAttachmentTooLargeMessage(oversized.name, effectiveMaxBytes) }
    : { step: "send" };
}

export type ThreadOutboxCommandStage = "settings-sync" | "branch-resolution" | "start-turn";
export type ThreadOutboxFailureAction = "retry" | "restore";

export function resolveThreadOutboxFailureAction(input: {
  readonly stage: ThreadOutboxCommandStage;
  readonly error: unknown;
  readonly interrupted: boolean;
}): ThreadOutboxFailureAction {
  if (
    input.stage === "settings-sync" ||
    input.interrupted ||
    shouldRetryThreadOutboxDelivery(input.error)
  ) {
    return "retry";
  }
  return "restore";
}
