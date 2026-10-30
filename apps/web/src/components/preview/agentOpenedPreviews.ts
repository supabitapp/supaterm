import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@supaterm/client-runtime/environment";
import type {
  DeviceServiceState,
  EnvironmentId,
  PreviewSessionSnapshot,
  ScopedThreadRef,
  ThreadId,
} from "@supaterm/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

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
import { useRightPanelStore } from "../../rightPanelStore";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { deviceEnvironment } from "../../state/device";
import { readEnvironmentSupportsServerBrowser } from "../../state/entities";
import { environmentPresentations } from "../../state/presentation";

export function revealServerTabs(
  threadRef: ScopedThreadRef,
  sessions: ReadonlyArray<PreviewSessionSnapshot>,
  options: { readonly autoShowFloatingPreview: boolean },
): void {
  if (!readEnvironmentSupportsServerBrowser(threadRef.environmentId)) return;
  for (const session of sessions) {
    const force = session.revealRequest?.force === true;
    if (!options.autoShowFloatingPreview && !force) continue;
    const surface = useRightPanelStore
      .getState()
      .byThreadKey[scopedThreadKey(threadRef)]?.surfaces.find(
        (surface) => surface.kind === "preview" && surface.resourceId === session.tabId,
      );
    if (surface && force) {
      useRightPanelStore.getState().activateSurface(threadRef, surface.id);
    } else if (!surface) {
      usePreviewMiniPlayerStore.getState().open(threadRef, browserMiniPlayerSource(session.tabId));
    }
  }
}

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

function followThread(threadKey: string, threadRef: ScopedThreadRef): () => void {
  const atom = previewStateAtom(threadKey);
  let previous = appAtomRegistry.get(atom);
  return appAtomRegistry.subscribe(atom, (next) => {
    const before = previous;
    previous = next;
    const revealed = freshlyRevealedServerTabs(before, next);
    if (revealed.length > 0) {
      revealServerTabs(threadRef, revealed, {
        autoShowFloatingPreview: getClientSettings().browserAutoShowFloatingPreview,
      });
    }
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
): boolean {
  return state.sessions.some(
    (session) =>
      session.threadId === threadId &&
      session.hostId === target.hostId &&
      session.deviceId === target.deviceId,
  );
}

export function applyDeviceSnapshot(
  environmentId: EnvironmentId,
  state: DeviceServiceState,
  options: { readonly sheetLayout: boolean; readonly autoShowFloatingPreview: boolean },
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
  if (!previous || options.sheetLayout) return;
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
    if (options.autoShowFloatingPreview) {
      usePreviewMiniPlayerStore.getState().open(threadRef, { kind: "device", ...target });
      continue;
    }
    const existing = useRightPanelStore
      .getState()
      .byThreadKey[scopedThreadKey(threadRef)]?.surfaces.some(
        (surface) =>
          surface.kind === "device" &&
          surface.target?.hostId === session.hostId &&
          surface.target.deviceId === session.deviceId,
      );
    if (existing) continue;
    useRightPanelStore.getState().openDevice(threadRef, target, true);
  }
}

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
      applyDeviceSnapshot(environmentId, state, {
        sheetLayout: window.matchMedia(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY).matches,
        autoShowFloatingPreview: getClientSettings().browserAutoShowFloatingPreview,
      });
    },
    { immediate: true },
  );
}

const connectedEnvironmentIdsAtom = Atom.make((get) =>
  [...get(environmentPresentations.presentationsAtom)].flatMap(([id, presentation]) =>
    presentation.connection.phase === "connected" ? [id] : [],
  ),
).pipe(Atom.withLabel("preview-connected-environments"));

export function startAgentOpenedPreviews(): () => void {
  const followed = new Map<string, () => void>();
  const followNewThreads = (refs: ReadonlyMap<string, ScopedThreadRef>) => {
    for (const [key, stop] of followed) {
      if (refs.has(key)) continue;
      stop();
      followed.delete(key);
    }
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
    connectedEnvironmentIdsAtom,
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
