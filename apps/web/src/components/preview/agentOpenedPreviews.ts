import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@supaterm/client-runtime/environment";
import type {
  BrowserAgentOpenTarget,
  DeviceServiceState,
  EnvironmentId,
  PreviewSessionSnapshot,
  ScopedThreadRef,
  ThreadId,
} from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";

import { getClientSettings } from "../../hooks/useSettings";
import {
  browserMiniPlayerSource,
  type PreviewMiniPlayerSource,
  usePreviewMiniPlayerStore,
} from "../../previewMiniPlayerStore";
import {
  previewStateAtom,
  previewThreadRefsAtom,
  type ThreadPreviewState,
} from "../../previewStateStore";
import { type PanelOpenOrigin, useRightPanelStore } from "../../rightPanelStore";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { deviceEnvironment } from "../../state/device";
import { readEnvironmentSupportsServerBrowser } from "../../state/entities";
import { environmentSummaries } from "../../state/presentation";

interface RevealOptions {
  readonly openTarget: BrowserAgentOpenTarget;
  readonly sheetLayout: boolean;
}

/** A sheet would cover the chat, so only an explicit request opens one. */
const panelOrigin = (options: RevealOptions, force: boolean): PanelOpenOrigin =>
  force || (options.openTarget === "panel" && !options.sheetLayout) ? "agent" : "agent-quiet";

const hasBrowserTab = (threadRef: ScopedThreadRef, tabId: string): boolean =>
  useRightPanelStore
    .getState()
    .byThreadKey[scopedThreadKey(threadRef)]?.surfaces.some(
      (surface) => surface.kind === "preview" && surface.resourceId === tabId,
    ) === true;

/**
 * Shows browsers an agent or another client revealed for a thread: floating
 * over chat until they have a panel tab, otherwise as right panel tabs. A
 * quiet reveal leaves the tab to `followPreviewSessions`.
 */
export function revealServerTabs(
  threadRef: ScopedThreadRef,
  sessions: ReadonlyArray<PreviewSessionSnapshot>,
  options: RevealOptions,
): void {
  if (!readEnvironmentSupportsServerBrowser(threadRef.environmentId)) return;
  for (const session of sessions) {
    if (options.openTarget === "floating" && !hasBrowserTab(threadRef, session.tabId)) {
      usePreviewMiniPlayerStore.getState().open(threadRef, browserMiniPlayerSource(session.tabId));
    } else if (panelOrigin(options, session.revealRequest?.force === true) === "agent") {
      useRightPanelStore.getState().openBrowser(threadRef, session.tabId, "agent");
    }
  }
}

/**
 * Keeps a thread's browser panel tabs and floating browser in step with its
 * preview sessions. Server-hosted sessions are only complete once the first
 * list has loaded; before that, a missing session is not a closed one.
 */
export function followPreviewSessions(threadRef: ScopedThreadRef, state: ThreadPreviewState): void {
  if (readEnvironmentSupportsServerBrowser(threadRef.environmentId) && !state.listLoaded) return;
  const sessions = Object.values(state.sessions);
  useRightPanelStore.getState().reconcileBrowserSurfaces(
    threadRef,
    sessions.map((session) => session.tabId),
    new Set(
      sessions
        .filter((session) => session.runtime === "server" && session.reveal === false)
        .map((session) => session.tabId),
    ),
  );
  const miniPlayer = usePreviewMiniPlayerStore.getState();
  const source = miniPlayer.byThreadKey[scopedThreadKey(threadRef)]?.source;
  if (source?.kind === "browser" && !state.sessions[source.tabId]) miniPlayer.close(threadRef);
}

/**
 * Server tabs that are new, or carry a new reveal request, since `previous`.
 * Nothing is fresh until the first list has loaded: that list is the baseline,
 * so a reload never reopens previews the user dismissed. A tab this client was
 * closing comes back without a reveal if the close fails.
 */
function freshlyRevealedServerTabs(
  previous: ThreadPreviewState,
  next: ThreadPreviewState,
): ReadonlyArray<PreviewSessionSnapshot> {
  if (!previous.listLoaded || previous.sessions === next.sessions) return [];
  return Object.values(next.sessions).filter((session) => {
    if (session.runtime !== "server" || session.reveal !== true) return false;
    if (previous.suppressedTabIds.has(session.tabId)) return false;
    const before = previous.sessions[session.tabId];
    const requested = session.revealRequest;
    return requested ? before?.revealRequest?.id !== requested.id : before === undefined;
  });
}

const currentRevealOptions = (): RevealOptions => ({
  openTarget: getClientSettings().browserAgentOpenTarget,
  sheetLayout: window.matchMedia(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY).matches,
});

function followThread(threadKey: string, threadRef: ScopedThreadRef): () => void {
  const atom = previewStateAtom(threadKey);
  let previous = appAtomRegistry.get(atom);
  return appAtomRegistry.subscribe(atom, (next) => {
    const before = previous;
    previous = next;
    // Reveals run first so a revealed tab floats before it gains a panel tab.
    const revealed = freshlyRevealedServerTabs(before, next);
    if (revealed.length > 0) revealServerTabs(threadRef, revealed, currentRevealOptions());
    if (before.sessions !== next.sessions || before.listLoaded !== next.listLoaded) {
      followPreviewSessions(threadRef, next);
    }
  });
}

// `openedAt` tells a session apart from one that ended and reopened on the same device while
// this client was disconnected.
const sessionKey = (session: DeviceServiceState["sessions"][number]) =>
  `${session.threadId}:${session.hostId}:${session.deviceId}:${session.openedAt}`;

/**
 * Per environment: the device sessions seen in the last snapshot. The first
 * snapshot is a baseline, so persisted tabs restore themselves and existing
 * sessions never resurrect tabs the user closed. Baselines outlive a
 * disconnect, so a device an agent opened during the gap still shows.
 */
const deviceSessionBaselines = new Map<EnvironmentId, ReadonlySet<string>>();

function hasLiveSession(
  state: DeviceServiceState,
  threadId: ThreadId,
  target: { readonly hostId: string; readonly deviceId: string },
): boolean {
  return state.sessions.some(
    (session) =>
      session.threadId === threadId &&
      session.hostId === target.hostId &&
      session.deviceId === target.deviceId,
  );
}

/**
 * A device the agent opens floats over its thread's chat or becomes a right
 * panel tab; a sheet layout always gets the tab. A session without a device
 * summary yet stays out of the baseline so a later snapshot opens it.
 * Floating devices whose session ended close here.
 */
export function applyDeviceSnapshot(
  environmentId: EnvironmentId,
  state: DeviceServiceState,
  options: RevealOptions,
): void {
  const deviceFor = (session: DeviceServiceState["sessions"][number]) =>
    state.devices.find((entry) => entry.hostId === session.hostId && entry.id === session.deviceId);

  const miniPlayer = usePreviewMiniPlayerStore.getState();
  for (const [threadKey, entry] of Object.entries(miniPlayer.byThreadKey)) {
    if (entry.source.kind !== "device") continue;
    const ref = parseScopedThreadKey(threadKey);
    if (ref?.environmentId === environmentId && !hasLiveSession(state, ref.threadId, entry.source))
      miniPlayer.close(ref);
  }

  const previous = deviceSessionBaselines.get(environmentId);
  deviceSessionBaselines.set(
    environmentId,
    new Set(state.sessions.filter((session) => deviceFor(session) !== undefined).map(sessionKey)),
  );
  if (!previous) return;
  for (const session of state.sessions) {
    if (previous.has(sessionKey(session))) continue;
    const device = deviceFor(session);
    if (!device) continue;
    const threadRef = scopeThreadRef(environmentId, session.threadId);
    const target = {
      hostId: session.hostId,
      deviceId: session.deviceId,
      platform: device.platform,
      name: device.name,
    };
    if (options.openTarget === "floating" && !options.sheetLayout) {
      miniPlayer.open(threadRef, { kind: "device", ...target });
    } else {
      useRightPanelStore.getState().openDevice(threadRef, target, panelOrigin(options, false));
    }
  }
}

/**
 * Floats a device panel tab over chat. A tab whose device session already
 * ended has nothing to stream, so it only closes the panel. Before the first
 * device snapshot the tab floats, and that snapshot closes it if needed.
 */
export function floatDeviceSurface(
  threadRef: ScopedThreadRef,
  source: Extract<PreviewMiniPlayerSource, { kind: "device" }>,
  state: DeviceServiceState | null,
): void {
  if (state !== null && !hasLiveSession(state, threadRef.threadId, source)) return;
  usePreviewMiniPlayerStore.getState().open(threadRef, source);
}

export function resetDeviceSessionBaselinesForTests(): void {
  deviceSessionBaselines.clear();
}

function watchEnvironmentDevices(environmentId: EnvironmentId): () => void {
  return appAtomRegistry.subscribe(
    deviceEnvironment.state({ environmentId, input: {} }),
    (result) => {
      const state = AsyncResult.getOrElse(result, () => null);
      if (state === null) return;
      applyDeviceSnapshot(environmentId, state, currentRevealOptions());
    },
    { immediate: true },
  );
}

/**
 * Follows every thread's browser previews and every connected environment's
 * device sessions for the life of the page, not just the open thread's: an
 * agent in a background thread can open either.
 */
export function startAgentOpenedPreviews(): () => void {
  const followed = new Map<string, () => void>();
  const followNewThreads = (refs: ReadonlyMap<string, ScopedThreadRef>) => {
    for (const [threadKey, threadRef] of refs) {
      if (!followed.has(threadKey)) followed.set(threadKey, followThread(threadKey, threadRef));
    }
  };
  const stopIndex = appAtomRegistry.subscribe(previewThreadRefsAtom, followNewThreads, {
    immediate: true,
  });
  const watchedEnvironments = new Map<EnvironmentId, () => void>();
  const watchConnectedEnvironments = (environmentIds: ReadonlyArray<EnvironmentId>) => {
    for (const [environmentId, stop] of watchedEnvironments) {
      if (environmentIds.includes(environmentId)) continue;
      stop();
      watchedEnvironments.delete(environmentId);
    }
    for (const environmentId of environmentIds) {
      if (!watchedEnvironments.has(environmentId)) {
        watchedEnvironments.set(environmentId, watchEnvironmentDevices(environmentId));
      }
    }
  };
  const stopEnvironments = appAtomRegistry.subscribe(
    environmentSummaries.connectedEnvironmentIdsAtom,
    watchConnectedEnvironments,
    { immediate: true },
  );
  return () => {
    stopIndex();
    stopEnvironments();
    for (const stop of followed.values()) stop();
    for (const stop of watchedEnvironments.values()) stop();
  };
}
