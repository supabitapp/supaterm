import type {
  DesktopRuntimeInfo,
  DesktopUpdateChannel,
  DesktopUpdateReleaseNote,
  DesktopUpdateState,
} from "@supaterm/contracts";

function nextStatusAfterDownloadFailure(currentState: DesktopUpdateState) {
  return currentState.availableVersion ? "available" : "error";
}

function getCanRetryAfterDownloadFailure(currentState: DesktopUpdateState) {
  return currentState.availableVersion !== null;
}

export function createInitialDesktopUpdateState(
  currentVersion: string,
  runtimeInfo: DesktopRuntimeInfo,
  channel: DesktopUpdateChannel,
) {
  return {
    enabled: false,
    status: "disabled",
    channel,
    currentVersion,
    hostArch: runtimeInfo.hostArch,
    appArch: runtimeInfo.appArch,
    runningUnderArm64Translation: runtimeInfo.runningUnderArm64Translation,
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  } satisfies DesktopUpdateState;
}

export function reduceDesktopUpdateStateOnCheckStart(state: DesktopUpdateState, checkedAt: string) {
  const hasDownloadedUpdate = state.downloadedVersion !== null;
  return {
    ...state,
    status: "checking",
    checkedAt,
    releaseNotes: hasDownloadedUpdate ? state.releaseNotes : [],
    omittedReleaseCount: hasDownloadedUpdate ? state.omittedReleaseCount : 0,
    message: null,
    downloadPercent: hasDownloadedUpdate ? 100 : null,
    errorContext: null,
    canRetry: false,
  } satisfies DesktopUpdateState;
}

export function reduceDesktopUpdateStateOnCheckFailure(
  state: DesktopUpdateState,
  message: string,
  checkedAt: string,
) {
  if (state.downloadedVersion !== null) {
    return {
      ...state,
      status: "downloaded",
      message: null,
      checkedAt,
      downloadPercent: 100,
      errorContext: null,
      canRetry: true,
    } satisfies DesktopUpdateState;
  }

  return {
    ...state,
    status: "error",
    message,
    checkedAt,
    downloadPercent: null,
    errorContext: "check",
    canRetry: true,
  } satisfies DesktopUpdateState;
}

export function reduceDesktopUpdateStateOnUpdateAvailable(
  state: DesktopUpdateState,
  version: string,
  checkedAt: string,
  releaseNotes: ReadonlyArray<DesktopUpdateReleaseNote> = [],
  omittedReleaseCount = 0,
) {
  const isDownloadedVersion = state.downloadedVersion === version;
  const preserveReleaseNotes = isDownloadedVersion && releaseNotes.length === 0;
  return {
    ...state,
    status: isDownloadedVersion ? "downloaded" : "available",
    availableVersion: version,
    downloadedVersion: isDownloadedVersion ? version : null,
    releaseNotes: preserveReleaseNotes ? state.releaseNotes : releaseNotes,
    omittedReleaseCount: preserveReleaseNotes ? state.omittedReleaseCount : omittedReleaseCount,
    downloadPercent: isDownloadedVersion ? 100 : null,
    checkedAt,
    message: null,
    errorContext: null,
    canRetry: isDownloadedVersion,
  } satisfies DesktopUpdateState;
}

export function reduceDesktopUpdateStateOnNoUpdate(state: DesktopUpdateState, checkedAt: string) {
  if (state.downloadedVersion !== null) {
    return {
      ...state,
      status: "downloaded",
      availableVersion: state.downloadedVersion,
      downloadPercent: 100,
      checkedAt,
      message: null,
      errorContext: null,
      canRetry: true,
    } satisfies DesktopUpdateState;
  }

  return {
    ...state,
    status: "up-to-date",
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt,
    message: null,
    errorContext: null,
    canRetry: false,
  } satisfies DesktopUpdateState;
}

export function reduceDesktopUpdateStateOnDownloadStart(state: DesktopUpdateState) {
  return {
    ...state,
    status: "downloading",
    downloadPercent: 0,
    message: null,
    errorContext: null,
    canRetry: false,
  } satisfies DesktopUpdateState;
}

export function reduceDesktopUpdateStateOnDownloadFailure(
  state: DesktopUpdateState,
  message: string,
) {
  return {
    ...state,
    status: nextStatusAfterDownloadFailure(state),
    message,
    downloadPercent: null,
    errorContext: "download",
    canRetry: getCanRetryAfterDownloadFailure(state),
  } satisfies DesktopUpdateState;
}

export function reduceDesktopUpdateStateOnDownloadProgress(
  state: DesktopUpdateState,
  percent: number,
) {
  return {
    ...state,
    status: "downloading",
    downloadPercent: percent,
    message: null,
    errorContext: null,
    canRetry: false,
  } satisfies DesktopUpdateState;
}

export function reduceDesktopUpdateStateOnDownloadComplete(
  state: DesktopUpdateState,
  version: string,
) {
  return {
    ...state,
    status: "downloaded",
    availableVersion: version,
    downloadedVersion: version,
    downloadPercent: 100,
    message: null,
    errorContext: null,
    canRetry: true,
  } satisfies DesktopUpdateState;
}

export function reduceDesktopUpdateStateOnInstallFailure(
  state: DesktopUpdateState,
  message: string,
): DesktopUpdateState;
export function reduceDesktopUpdateStateOnInstallFailure(
  state: DesktopUpdateState,
  message: string,
) {
  return {
    ...state,
    status: "downloaded",
    message,
    errorContext: "install",
    canRetry: true,
  } satisfies DesktopUpdateState;
}

export interface DesktopUpdateInstallRecord {
  readonly fromVersion: string;
  readonly targetVersion: string;
}

export function resolveNotAppliedInstallVersion(
  record: DesktopUpdateInstallRecord,
  appVersion: string,
) {
  return record.fromVersion === appVersion && record.targetVersion !== appVersion
    ? record.targetVersion
    : null;
}
