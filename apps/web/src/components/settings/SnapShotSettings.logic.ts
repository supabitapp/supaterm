import type { ClientSettingsPatch, DesktopSnapShotState, SnapShotSound } from "@supaterm/contracts";
import {
  captureSetupBackend,
  captureSetupDesktopName,
  captureSetupAccessReady,
  captureSetupMacPermissionsReady,
} from "./SnapShotSetupDialog.logic";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";

export function snapShotStatus(state: DesktopSnapShotState | null, enabled: boolean): string {
  if (!state) return msg("Checking snapshots…");
  if (state.mode === "unavailable") return state.message ?? msg("Not supported on this platform.");
  if (!enabled) return msg("Turn this on to set up snapshots.");
  return snapShotSetupSummary(state, enabled);
}

export function snapShotSetupSummary(state: DesktopSnapShotState, enabled: boolean): string {
  if (state.message) return msg("Capture needs attention");
  if (state.linuxBackend === "hyprland" && state.hyprlandHelper?.status !== "ready")
    return state.hyprlandHelper?.status === "error"
      ? msg("Check capture access in setup")
      : msg("Install the capture helper to continue");
  if (captureSetupBackend(state) === "gnome" && state.gnomeExtension?.status !== "enabled")
    return msg("Set up active-window snapshots");
  if (captureSetupBackend(state) === "kde" && state.kdeHelper?.status !== "ready")
    return state.kdeHelper?.status === "error"
      ? msg("Check capture access in setup")
      : msg("Install the capture helper to continue");
  if (captureSetupBackend(state) === "picker")
    return msg("Manual capture only. You'll choose a window each time");
  if (!enabled) return msg("Enable capture to continue");
  if (state.shortcutPending)
    return state.linuxBackend === "hyprland"
      ? msg("Connecting your shortcut…")
      : msg("Waiting for shortcut permission");
  if (state.shortcutVerified) return msg("Ready to capture");
  if (state.linuxBackend === "niri" && state.shortcutBinding)
    return msg("Use your shortcut from another app");
  if (state.linuxBackend === "hyprland" && state.shortcutActionRegistered)
    return msg("Use your shortcut from another app");
  if (state.shortcutRegistered)
    return state.shortcutLabel ? msg("Ready to capture") : msg("Shortcut saved");
  return msg("Finish shortcut setup");
}

export function snapShotShortcutStatus(state: DesktopSnapShotState | null): string | null {
  if (!state) return null;
  if (state.linuxBackend === "hyprland") return state.shortcutMessage;
  if (state.shortcutPending) return msg("Approve the shortcut permission prompt to continue.");
  if (state.shortcutRegistered) return state.mode === "portal" ? null : msg("Shortcut saved.");
  return state.shortcutMessage;
}

export function snapShotSetupButtonLabel(
  state: DesktopSnapShotState | null,
  resolve: MessageResolver = m,
): string {
  if (!state) return resolve(msg("Continue setup"));
  if (captureSetupAccessReady(state)) return resolve(msg("Manage capture"));
  const desktop = captureSetupDesktopName(state);
  return desktop
    ? resolve(msg("Set up {desktop} capture", { desktop }))
    : resolve(msg("Continue setup"));
}

export function snapShotSetupComplete(
  state: DesktopSnapShotState | null,
  includeAccessibility: boolean,
): boolean {
  if (state?.windows) return true;
  return (
    state?.macPermissions !== undefined &&
    captureSetupAccessReady(state) &&
    captureSetupMacPermissionsReady(state, includeAccessibility) &&
    state.shortcutRegistered
  );
}

export type SnapShotSoundSelection = SnapShotSound | "off";

export function snapShotFeedbackUnavailableMessage(
  state: DesktopSnapShotState | null,
): string | undefined {
  if (state?.mode !== "portal" || state.linuxFeedbackAvailable) return undefined;
  if (state.linuxBackend === "hyprland")
    return state.hyprlandHelper?.status === "ready"
      ? msg("Capture effects aren't available on this desktop.")
      : msg("Install or update the capture helper to enable effects.");
  if (state.linuxBackend === "niri") return msg("Capture effects aren't available on Niri.");
  if (state.linuxBackend === "kde")
    return state.kdeHelper?.status === "ready"
      ? msg("Capture effects aren't available on this desktop.")
      : msg("Install or update the capture helper to enable effects.");
  return state.linuxBackend === "gnome-extension"
    ? msg("Update the GNOME extension, then sign out and back in to enable effects.")
    : captureSetupBackend(state) === "gnome"
      ? msg("Finish extension setup to enable effects.")
      : msg("Capture effects aren't available on this desktop.");
}

export function snapShotDescription(state: DesktopSnapShotState | null): string {
  return state?.mode === "portal" && captureSetupBackend(state) === "picker"
    ? msg("Automatic capture isn't available here. Choose a window instead.")
    : msg("Capture a window and attach it to your current draft.");
}

export function snapShotAccessibilityUnavailableMessage(
  state: DesktopSnapShotState | null,
): string | undefined {
  if (state?.mode !== "portal") return undefined;
  if (state.linuxBackend === "picker" || state.linuxBackend === "screenshot-portal")
    return msg("This desktop only provides a screenshot.");
  return undefined;
}

export function snapShotUnavailableMessage(hasBridge: boolean): string | undefined {
  if (hasBridge) return undefined;
  return typeof window !== "undefined" && window.desktopBridge
    ? msg("Update the desktop app to use snapshots.")
    : msg("Only available in the desktop app.");
}

export function snapShotSoundPatch(sound: SnapShotSoundSelection): ClientSettingsPatch {
  return sound === "off"
    ? { snapShotPlaySound: false }
    : { snapShotPlaySound: true, snapShotSound: sound };
}

export function createRecordingRequestTracker() {
  let currentRequest: symbol | null = null;

  return {
    tryBegin() {
      if (currentRequest) return null;
      currentRequest = Symbol();
      return currentRequest;
    },
    clear() {
      currentRequest = null;
    },
    owns(request: symbol) {
      return currentRequest === request;
    },
  };
}
