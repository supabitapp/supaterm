import type { DesktopUpdateRemoteOutcome, DesktopUpdateState } from "@supaterm/contracts";

export type RemoteDesktopUpdateStep =
  | { readonly action: "check" }
  | { readonly action: "download" }
  | { readonly action: "install" }
  | { readonly action: "wait" }
  | {
      readonly action: "done";
      readonly outcome: DesktopUpdateRemoteOutcome;
      readonly reason?: string;
    };

/** Bound retries with counts: background poller races can repeat an already-handled status once. */
export interface RemoteDesktopUpdateAttempts {
  readonly checks: number;
  readonly downloads: number;
}

const MAX_REMOTE_UPDATE_CHECKS = 2;
export const MAX_REMOTE_UPDATE_DOWNLOADS = 3;

function isInstallableDesktopUpdateState(state: DesktopUpdateState) {
  return (
    state.downloadedVersion !== null &&
    (state.status === "downloaded" ||
      (state.status === "error" &&
        (state.errorContext === null || state.errorContext === "install")))
  );
}

export function nextRemoteDesktopUpdateStep(
  state: DesktopUpdateState,
  attempts: RemoteDesktopUpdateAttempts,
  disabledReason: string | null,
) {
  if (!state.enabled || state.status === "disabled") {
    return {
      action: "done",
      outcome: "failed",
      reason: disabledReason ?? "Automatic updates are disabled on this machine.",
    } satisfies RemoteDesktopUpdateStep;
  }
  if (
    state.notAppliedVersion !== undefined &&
    (state.downloadedVersion ?? state.availableVersion) === state.notAppliedVersion
  ) {
    return {
      action: "done",
      outcome: "failed",
      reason: `Update ${state.notAppliedVersion} did not apply on this machine. Retry it from the desktop app there.`,
    } satisfies RemoteDesktopUpdateStep;
  }
  if (isInstallableDesktopUpdateState(state)) {
    return { action: "install" } satisfies RemoteDesktopUpdateStep;
  }
  if (state.status === "downloading" || state.status === "checking") {
    return { action: "wait" } satisfies RemoteDesktopUpdateStep;
  }
  if (state.status === "available") {
    if (attempts.downloads >= MAX_REMOTE_UPDATE_DOWNLOADS) {
      return {
        action: "done",
        outcome: "failed",
        reason: state.message ?? "The desktop app failed to download the update.",
      } satisfies RemoteDesktopUpdateStep;
    }
    return { action: "download" } satisfies RemoteDesktopUpdateStep;
  }
  if (state.status === "up-to-date") {
    if (attempts.checks === 0) {
      return { action: "check" } satisfies RemoteDesktopUpdateStep;
    }
    return { action: "done", outcome: "up-to-date" } satisfies RemoteDesktopUpdateStep;
  }
  if (state.status === "error") {
    if (attempts.checks === 0) {
      return { action: "check" } satisfies RemoteDesktopUpdateStep;
    }
    return {
      action: "done",
      outcome: "failed",
      reason: state.message ?? "The desktop app update failed.",
    } satisfies RemoteDesktopUpdateStep;
  }
  if (attempts.checks >= MAX_REMOTE_UPDATE_CHECKS) {
    return {
      action: "done",
      outcome: "failed",
      reason: "The desktop app did not report an update result.",
    } satisfies RemoteDesktopUpdateStep;
  }
  return { action: "check" } satisfies RemoteDesktopUpdateStep;
}

/** Blank reasons fail encoding and drop the terminal report, forcing the server to time out. */
export function normalizeRemoteUpdateReason(reason: string | undefined) {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : undefined;
}
