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
import { selectDeviceDismissed, useRightPanelStore } from "../../rightPanelStore";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { deviceEnvironment } from "../../state/device";
import { readEnvironmentSupportsServerBrowser } from "../../state/entities";
import { environmentSummaries } from "../../state/presentation";

interface RevealOptions {
  readonly openTarget: BrowserAgentOpenTarget;
  readonly sheetLayout: boolean;
}

const panelOrigin = (options: RevealOptions, force: boolean) =>
  force || (options.openTarget === "panel" && !options.sheetLayout) ? "agent" : "agent-quiet";

const hasBrowserTab = (threadRef: ScopedThreadRef, tabId: string) =>
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
) {
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
export function followPreviewSessions(threadRef: ScopedThreadRef, state: ThreadPreviewState) {
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

function freshlyRevealedServerTabs(previous: ThreadPreviewState, next: ThreadPreviewState) {
  if (!previous.listLoaded || previous.sessions === next.sessions) return [];
  return Object.values(next.sessions).filter((session) => {
    if (session.runtime !== "server" || session.reveal !== true) return false;
    if (previous.suppressedTabIds.has(session.tabId)) return false;
    const before = previous.sessions[session.tabId];
    const requested = session.revealRequest;
    return requested ? before?.revealRequest?.id !== requested.id : before === undefined;
  });
}

const currentRevealOptions = () => ({
  openTarget: getClientSettings().browserAgentOpenTarget,
  sheetLayout: window.matchMedia(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY).matches,
});

function followThread(threadKey: string, threadRef: ScopedThreadRef) {
  const atom = previewStateAtom(threadKey);
  let previous = appAtomRegistry.get(atom);
  return appAtomRegistry.subscribe(atom, (next) => {
    const before = previous;
    previous = next;
    const revealed = freshlyRevealedServerTabs(before, next);
    if (revealed.length > 0) revealServerTabs(threadRef, revealed, currentRevealOptions());
    if (before.sessions !== next.sessions || before.listLoaded !== next.listLoaded) {
      followPreviewSessions(threadRef, next);
    }
  });
}

const sessionKey = (session: DeviceServiceState["sessions"][number]) =>
  `${session.threadId}:${session.hostId}:${session.deviceId}:${session.openedAt}`;

const deviceSessionBaselines = new Map<EnvironmentId, ReadonlySet<string>>();

function hasLiveSession(
  state: DeviceServiceState,
  threadId: ThreadId,
  target: { readonly hostId: string; readonly deviceId: string },
) {
  return state.sessions.some(
    (session) =>
      session.threadId === threadId &&
      session.hostId === target.hostId &&
      session.deviceId === target.deviceId,
  );
}

/**
 * A device the agent opens floats over its thread's chat or becomes a right
 * panel tab; a sheet layout always gets the tab, and one the user closed gets
 * neither. A session without a device summary yet stays out of the baseline so
 * a later snapshot opens it. Floating devices whose session ended close here.
 */
export function applyDeviceSnapshot(
  environmentId: EnvironmentId,
  state: DeviceServiceState,
  options: RevealOptions,
) {
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
    const panel = useRightPanelStore.getState();
    if (options.openTarget !== "floating" || options.sheetLayout) {
      panel.openDevice(threadRef, target, panelOrigin(options, false));
    } else if (!selectDeviceDismissed(panel.byThreadKey, threadRef, target)) {
      miniPlayer.open(threadRef, { kind: "device", ...target });
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
) {
  if (state !== null && !hasLiveSession(state, threadRef.threadId, source)) return;
  usePreviewMiniPlayerStore.getState().open(threadRef, source);
}

export function resetDeviceSessionBaselinesForTests() {
  deviceSessionBaselines.clear();
}

function watchEnvironmentDevices(environmentId: EnvironmentId) {
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
export function startAgentOpenedPreviews() {
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
