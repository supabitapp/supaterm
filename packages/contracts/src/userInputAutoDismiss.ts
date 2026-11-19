import * as DateTime from "effect/DateTime";
import type { OrchestrationV2RuntimeRequest } from "./orchestrationV2.ts";

export const USER_INPUT_AUTO_DISMISS_TIMEOUT_MS = 120_000;

export function canAutoDismissUserInput(request: OrchestrationV2RuntimeRequest): boolean {
  const driver = request.nativeRequestRef?.driver;
  return (
    request.kind === "user_input" &&
    request.status === "pending" &&
    request.responseCapability.type !== "not_resumable" &&
    (driver === "codex" || driver === "claudeAgent")
  );
}

export function userInputAutoDismissAt(
  request: OrchestrationV2RuntimeRequest,
): DateTime.Utc | null {
  if (!canAutoDismissUserInput(request) || request.autoDismissPaused === true) return null;
  return DateTime.add(request.createdAt, { milliseconds: USER_INPUT_AUTO_DISMISS_TIMEOUT_MS });
}
