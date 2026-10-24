import type { MicrophoneAccess } from "@supaterm/contracts";
import * as Electron from "electron";

type MediaRequestDecision = "allow" | "deny" | "ask";

type MicrophoneStatus = ReturnType<typeof Electron.systemPreferences.getMediaAccessStatus>;

export function isAppOrigin(candidate: string | undefined, appUrl: string): boolean {
  if (candidate === undefined) return false;
  try {
    const url = new URL(candidate);
    const app = new URL(appUrl);

    return app.host.length > 0 && url.protocol === app.protocol && url.host === app.host;
  } catch {
    return false;
  }
}

function resolveMicrophoneStatus(status: MicrophoneStatus): MediaRequestDecision {
  if (status === "granted") return "allow";
  if (status === "denied" || status === "restricted") return "deny";
  return "ask";
}

export function resolveMainWindowMediaRequest(input: {
  readonly requesterIsMain: boolean;
  readonly requestingOrigin: string | undefined;
  readonly appUrl: string;
  readonly mediaTypes: ReadonlyArray<"audio" | "video">;
  readonly platform: NodeJS.Platform;
  readonly microphoneStatus: () => MicrophoneStatus;
}): MediaRequestDecision {
  if (!input.requesterIsMain || !isAppOrigin(input.requestingOrigin, input.appUrl)) return "deny";
  if (input.mediaTypes.includes("video")) return "deny";

  if (!input.mediaTypes.includes("audio") || input.platform !== "darwin") return "allow";
  return resolveMicrophoneStatus(input.microphoneStatus());
}

export function isMainWindowPermissionCheckAllowed(input: {
  readonly permission: string;
  readonly requesterIsMain: boolean;
  readonly requestingOrigin: string;
  readonly mediaType: "audio" | "video" | "unknown" | undefined;
  readonly appUrl: string;
}): boolean {
  if (input.permission === "deprecated-sync-clipboard-read") return false;
  if (input.permission !== "media") return true;
  return (
    input.requesterIsMain &&
    input.mediaType !== "video" &&
    isAppOrigin(input.requestingOrigin, input.appUrl)
  );
}

const readMicrophoneStatus = () => Electron.systemPreferences.getMediaAccessStatus("microphone");

const askForMicrophone = () =>
  Electron.systemPreferences.askForMediaAccess("microphone").catch(() => false);

export async function requestSystemMicrophoneAccess(
  platform: NodeJS.Platform,
): Promise<MicrophoneAccess> {
  if (platform !== "darwin") return { granted: true, canAskAgain: true };
  const decision = resolveMicrophoneStatus(readMicrophoneStatus());
  if (decision !== "ask") {
    return { granted: decision === "allow", canAskAgain: decision === "allow" };
  }
  const granted = await askForMicrophone();
  return { granted, canAskAgain: granted || readMicrophoneStatus() === "not-determined" };
}

export function isSystemMicrophoneGranted(platform: NodeJS.Platform): boolean {
  return platform !== "darwin" || readMicrophoneStatus() === "granted";
}

export function installMainWindowPermissions(
  webContents: Electron.WebContents,
  options: { readonly appUrl: string; readonly platform: NodeJS.Platform },
): void {
  webContents.session.setPermissionRequestHandler((requester, permission, callback, details) => {
    if (permission !== "media") {
      callback(true);
      return;
    }
    const decision = resolveMainWindowMediaRequest({
      requesterIsMain: requester === webContents,
      requestingOrigin:
        ("securityOrigin" in details ? details.securityOrigin : undefined) ?? details.requestingUrl,
      appUrl: options.appUrl,
      mediaTypes: ("mediaTypes" in details ? details.mediaTypes : undefined) ?? [],
      platform: options.platform,
      microphoneStatus: readMicrophoneStatus,
    });
    if (decision === "ask") {
      void askForMicrophone().then(callback);
      return;
    }
    callback(decision === "allow");
  });
  webContents.session.setPermissionCheckHandler(
    (requester, permission, requestingOrigin, details) =>
      isMainWindowPermissionCheckAllowed({
        permission,
        requesterIsMain: requester === webContents,
        requestingOrigin,
        mediaType: details.mediaType,
        appUrl: options.appUrl,
      }),
  );
}
