import { requireOptionalNativeModule } from "expo";
import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";

const nativeControls = requireOptionalNativeModule<{
  releaseVideoAudioSession(): Promise<void>;
}>("SupatermNativeControls");

const RELEASE_DELAY_MS = 1_000;

let playingCount = 0;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function mediaPlaybackStarted() {
  playingCount += 1;
}

function mediaPlaybackStopped() {
  playingCount -= 1;
  if (playingCount > 0 || Platform.OS !== "ios") return;
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    if (playingCount > 0) return;
    void nativeControls?.releaseVideoAudioSession().catch(() => undefined);
  }, RELEASE_DELAY_MS);
}

let fullscreenCount = 0;
const fullscreenListeners = new Set<() => void>();

export function fullscreenVideoOpened() {
  fullscreenCount += 1;
  for (const listener of fullscreenListeners) listener();
}

export function fullscreenVideoClosed() {
  fullscreenCount -= 1;
  for (const listener of fullscreenListeners) listener();
}

function subscribeFullscreenVideo(listener: () => void) {
  fullscreenListeners.add(listener);
  return () => {
    fullscreenListeners.delete(listener);
  };
}

function isFullscreenVideoOpen() {
  return fullscreenCount > 0;
}

export function useFullscreenVideoOpen() {
  return useSyncExternalStore(subscribeFullscreenVideo, isFullscreenVideoOpen);
}

export function useMediaAudioSessionHold(active: boolean) {
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- holds the shared native audio session while media plays and releases it on cleanup
  useEffect(() => {
    if (!active) return;
    mediaPlaybackStarted();
    return () => mediaPlaybackStopped();
  }, [active]);
}
