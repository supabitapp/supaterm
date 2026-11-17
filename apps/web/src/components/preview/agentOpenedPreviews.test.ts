import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  type DeviceServiceState,
  type EnvironmentId,
  type PreviewSessionSnapshot,
  ThreadId,
} from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { browserMiniPlayerSource, usePreviewMiniPlayerStore } from "../../previewMiniPlayerStore";
import {
  __testing as previewStateTesting,
  applyPreviewServerEvent,
  applyPreviewServerSnapshot,
  beginPreviewSessionClose,
  cancelPreviewSessionClose,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
} from "../../previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import {
  applyDeviceSnapshot,
  floatDeviceSurface,
  followPreviewSessions,
  resetDeviceSessionBaselinesForTests,
  revealServerTabs,
  startAgentOpenedPreviews,
} from "./agentOpenedPreviews";

vi.mock("../../state/entities", () => ({
  readEnvironmentSupportsServerBrowser: () => true,
}));

const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-1"));
const threadKey = scopedThreadKey(ref);

const device = {
  hostId: "local",
  id: "pixel",
  platform: "android",
  name: "Pixel 8",
  version: "15",
  booted: true,
  physical: false,
} as const;

const session = {
  threadId: ref.threadId,
  hostId: "local",
  deviceId: "pixel",
  platform: "android",
  openedAt: "2026-01-01T00:00:00.000Z",
} as const;

const deviceState = (input: {
  readonly sessions?: ReadonlyArray<
    Omit<typeof session, "openedAt"> & { readonly openedAt: string }
  >;
  readonly devices?: ReadonlyArray<typeof device>;
}) =>
  ({
    hosts: [],
    hostStatus: "ready",
    hostStatuses: {},
    devices: input.devices ?? [device],
    sessions: input.sessions ?? [],
    onboardingCompleted: true,
    agentAccessEnabled: true,
    hubBasePath: "/api/device-hub",
    revision: 0,
  }) as unknown as DeviceServiceState;

const autoOpen = { sheetLayout: false, openTarget: "panel" } as const;
const quiet = { sheetLayout: false, openTarget: "background" } as const;
const sheet = { sheetLayout: true, openTarget: "panel" } as const;
const floating = { sheetLayout: false, openTarget: "floating" } as const;
const floatingSheet = { sheetLayout: true, openTarget: "floating" } as const;

function setup() {
  resetPreviewStateForTests();
  resetDeviceSessionBaselinesForTests();
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  useRightPanelStore.setState({ byThreadKey: {} });
}

const miniPlayerSource = (threadRef = ref) =>
  usePreviewMiniPlayerStore.getState().byThreadKey[scopedThreadKey(threadRef)]?.source;
const floatingTabId = () => {
  const source = miniPlayerSource();
  return source?.kind === "browser" ? source.tabId : null;
};

const panel = (threadRef = ref) =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
const deviceTabs = (threadRef = ref) =>
  panel(threadRef)
    .surfaces.filter((surface) => surface.kind === "device")
    .map((surface) => surface.id);
const PIXEL_TAB = "device:local:pixel";

describe("applyDeviceSnapshot", () => {
  it("treats the first snapshot as a baseline and opens sessions that start later", () => {
    setup();
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [session] }), autoOpen);
    expect(deviceTabs()).toEqual([]);

    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [] }), autoOpen);
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [session] }), autoOpen);
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: PIXEL_TAB });
  });

  it("opens a session once its device summary arrives", () => {
    setup();
    applyDeviceSnapshot(ref.environmentId, deviceState({}), autoOpen);
    applyDeviceSnapshot(
      ref.environmentId,
      deviceState({ sessions: [session], devices: [] }),
      autoOpen,
    );
    expect(deviceTabs()).toEqual([]);

    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [session] }), autoOpen);
    expect(panel().surfaces).toEqual([
      expect.objectContaining({
        id: PIXEL_TAB,
        target: expect.objectContaining({ name: "Pixel 8" }),
      }),
    ]);
  });

  it("floats a session instead of opening the panel when agent opens float", () => {
    setup();
    applyDeviceSnapshot(ref.environmentId, deviceState({}), floating);
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [session] }), floating);
    expect(miniPlayerSource()).toMatchObject({ kind: "device", deviceId: "pixel" });
    expect(panel()).toMatchObject({ isOpen: false, surfaces: [] });
  });

  it("closes a floating device when its session ends, even before a baseline", () => {
    setup();
    usePreviewMiniPlayerStore.getState().open(ref, {
      kind: "device",
      hostId: "local",
      deviceId: "pixel",
      platform: "android",
      name: "Pixel 8",
    });
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [session] }), autoOpen);
    expect(miniPlayerSource()).toMatchObject({ kind: "device" });

    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [] }), autoOpen);
    expect(miniPlayerSource()).toBeUndefined();
  });

  it.each([
    ["agent opens stay in the background", quiet],
    ["the panel is a sheet", sheet],
    ["agent opens float but the panel is a sheet", floatingSheet],
  ])("adds the tab without opening the panel when %s", (_case, options) => {
    setup();
    applyDeviceSnapshot(ref.environmentId, deviceState({}), options);
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [session] }), options);
    applyDeviceSnapshot(ref.environmentId, deviceState({}), options);
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [session] }), options);
    expect(deviceTabs()).toEqual([PIXEL_TAB]);
    expect(panel()).toMatchObject({ isOpen: false, activeSurfaceId: null });
    expect(miniPlayerSource()).toBeUndefined();
  });

  it("does not reopen a device tab the user closed", () => {
    setup();
    applyDeviceSnapshot(ref.environmentId, deviceState({}), autoOpen);
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [session] }), autoOpen);
    useRightPanelStore.getState().closeSurface(ref, PIXEL_TAB);

    const reopened = { ...session, openedAt: "2026-01-01T00:05:00.000Z" };
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [reopened] }), autoOpen);
    expect(deviceTabs()).toEqual([]);
  });

  it("opens a session that ended and reopened between two snapshots", () => {
    setup();
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [session] }), autoOpen);
    expect(deviceTabs()).toEqual([]);

    const reopened = { ...session, openedAt: "2026-01-01T00:05:00.000Z" };
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [reopened] }), autoOpen);
    expect(deviceTabs()).toEqual([PIXEL_TAB]);
  });

  it("opens a device for a thread that had no sessions when the baseline was taken", () => {
    setup();
    const otherRef = scopeThreadRef(ref.environmentId, ThreadId.make("thread-2"));
    applyDeviceSnapshot(ref.environmentId, deviceState({ sessions: [session] }), autoOpen);
    applyDeviceSnapshot(
      ref.environmentId,
      deviceState({ sessions: [session, { ...session, threadId: otherRef.threadId }] }),
      autoOpen,
    );
    expect(deviceTabs()).toEqual([]);
    expect(deviceTabs(otherRef)).toEqual([PIXEL_TAB]);
  });
});

describe("floatDeviceSurface", () => {
  const source = {
    kind: "device",
    hostId: "local",
    deviceId: "pixel",
    platform: "android",
    name: "Pixel 8",
  } as const;

  it("floats a device with a live session, or before device state loads", () => {
    setup();
    floatDeviceSurface(ref, source, deviceState({ sessions: [session] }));
    expect(miniPlayerSource()).toMatchObject({ kind: "device", deviceId: "pixel" });

    setup();
    floatDeviceSurface(ref, source, null);
    expect(miniPlayerSource()).toMatchObject({ kind: "device", deviceId: "pixel" });
  });

  it("does not float a device whose session ended", () => {
    setup();
    floatDeviceSurface(ref, source, deviceState({ sessions: [] }));
    expect(miniPlayerSource()).toBeUndefined();
  });
});

describe("revealServerTabs", () => {
  const tab = (tabId: string, force?: boolean): PreviewSessionSnapshot => ({
    threadId: "thread-1",
    tabId,
    navStatus: { _tag: "Loading", url: "http://localhost:5173/", title: "" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    runtime: "server",
    reveal: true,
    ...(force === undefined ? {} : { revealRequest: { id: "r1", force } }),
  });

  it("opens the panel only on forced reveals when agent opens stay in the background", () => {
    setup();
    revealServerTabs(ref, [tab("tab_plain")], quiet);
    expect(panel()).toMatchObject({ isOpen: false, surfaces: [] });
    revealServerTabs(ref, [tab("tab_forced", true)], quiet);
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "browser:tab_forced" });
    expect(floatingTabId()).toBeNull();
  });

  it("floats a revealed tab that has no panel tab yet when agent opens float", () => {
    setup();
    revealServerTabs(ref, [tab("tab_plain")], floating);
    expect(floatingTabId()).toBe("tab_plain");
    expect(panel()).toMatchObject({ isOpen: false, surfaces: [] });
  });

  it("focuses a tab already in the panel instead of floating it when forced", () => {
    setup();
    useRightPanelStore.getState().openBrowser(ref, "tab_a");
    useRightPanelStore.getState().open(ref, "diff");

    revealServerTabs(ref, [tab("tab_a", false)], floating);
    expect(panel().activeSurfaceId).not.toBe("browser:tab_a");
    revealServerTabs(ref, [tab("tab_a", true)], floating);
    expect(panel().activeSurfaceId).toBe("browser:tab_a");
    expect(floatingTabId()).toBeNull();
  });

  it("opens a sheet only for a forced reveal", () => {
    setup();
    revealServerTabs(ref, [tab("tab_plain")], sheet);
    expect(panel().isOpen).toBe(false);
    revealServerTabs(ref, [tab("tab_forced", true)], sheet);
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "browser:tab_forced" });
  });

  it("focuses a tab already in the panel without counting as a user action", () => {
    setup();
    useRightPanelStore.getState().openBrowser(ref, "tab_a");
    useRightPanelStore.getState().open(ref, "diff");
    useRightPanelStore.getState().close(ref);
    const revision = useRightPanelStore.getState().getUserActionRevision(ref);

    revealServerTabs(ref, [tab("tab_a", false)], autoOpen);
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "browser:tab_a" });
    expect(useRightPanelStore.getState().getUserActionRevision(ref)).toBe(revision);
  });
});

describe("followPreviewSessions", () => {
  const snapshot = (tabId: string, reveal = true): PreviewSessionSnapshot => ({
    threadId: "thread-1",
    tabId,
    navStatus: { _tag: "Loading", url: "http://localhost:5173/", title: "" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    runtime: "server",
    reveal,
  });
  const previewState = (sessions: ReadonlyArray<PreviewSessionSnapshot>, listLoaded = true) => ({
    ...previewStateTesting.EMPTY_THREAD_PREVIEW_STATE,
    listLoaded,
    sessions: Object.fromEntries(sessions.map((entry) => [entry.tabId, entry])),
  });
  const browserTabs = () =>
    useRightPanelStore
      .getState()
      .byThreadKey[threadKey]?.surfaces.filter((surface) => surface.kind === "preview")
      .map((surface) => surface.id) ?? [];

  it("adds visible sessions as tabs and drops tabs whose session ended", () => {
    setup();
    useRightPanelStore.getState().openBrowser(ref, "tab_gone");
    followPreviewSessions(ref, previewState([snapshot("tab_a"), snapshot("tab_hidden", false)]));
    expect(browserTabs()).toEqual(["browser:tab_a"]);
  });

  it("waits for the first server list before treating missing sessions as closed", () => {
    setup();
    useRightPanelStore.getState().openBrowser(ref, "tab_a");
    usePreviewMiniPlayerStore.getState().open(ref, browserMiniPlayerSource("tab_a"));
    followPreviewSessions(ref, previewState([], false));
    expect(browserTabs()).toEqual(["browser:tab_a"]);
    expect(floatingTabId()).toBe("tab_a");

    followPreviewSessions(ref, previewState([]));
    expect(browserTabs()).toEqual([]);
    expect(floatingTabId()).toBeNull();
  });
});

describe("startAgentOpenedPreviews", () => {
  const serverEpoch = "server-a";
  const serverTab = (overrides: Partial<PreviewSessionSnapshot> = {}): PreviewSessionSnapshot => ({
    threadId: "thread-1",
    tabId: "tab_a",
    navStatus: { _tag: "Loading", url: "http://localhost:5173/", title: "" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    runtime: "server",
    reveal: true,
    ...overrides,
  });
  const following = () => {
    setup();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const stop = startAgentOpenedPreviews();
    return {
      [Symbol.dispose]: () => {
        stop();
        vi.unstubAllGlobals();
      },
    };
  };
  const navigated = (revision: number, snapshot: PreviewSessionSnapshot) =>
    applyPreviewServerEvent(ref, {
      type: "navigated",
      threadId: "thread-1",
      tabId: snapshot.tabId,
      createdAt: snapshot.updatedAt,
      snapshot,
      serverEpoch,
      revision,
    });
  const browserTabs = (threadKeyToRead = threadKey) =>
    useRightPanelStore
      .getState()
      .byThreadKey[threadKeyToRead]?.surfaces.filter((surface) => surface.kind === "preview")
      .map((surface) => surface.id) ?? [];

  it("treats the first list as a baseline and floats tabs opened later", () => {
    using _following = following();
    reconcilePreviewServerSessions(ref, {
      sessions: [serverTab({ tabId: "tab_restored" })],
      serverEpoch,
      revision: 1,
    });
    expect(floatingTabId()).toBeNull();
    expect(browserTabs()).toEqual(["browser:tab_restored"]);

    const opened = serverTab({ tabId: "tab_agent" });
    applyPreviewServerEvent(ref, {
      type: "opened",
      threadId: "thread-1",
      tabId: opened.tabId,
      createdAt: opened.updatedAt,
      snapshot: opened,
      serverEpoch,
      revision: 2,
    });
    expect(floatingTabId()).toBe("tab_agent");
    expect(panel().isOpen).toBe(false);
  });

  it("reveals an existing tab only for a new reveal request", () => {
    using _following = following();
    const tab = serverTab({ revealRequest: { id: "r1", force: false } });
    reconcilePreviewServerSessions(ref, { sessions: [tab], serverEpoch, revision: 1 });

    navigated(2, { ...tab, updatedAt: "2026-01-01T00:00:01.000Z" });
    expect(panel().isOpen).toBe(false);
    expect(floatingTabId()).toBeNull();

    navigated(3, {
      ...tab,
      revealRequest: { id: "r2", force: true },
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    expect(useRightPanelStore.getState().byThreadKey[threadKey]?.activeSurfaceId).toBe(
      "browser:tab_a",
    );
  });

  it("never reveals tabs this client opened, desktop tabs, or a tab whose close failed", () => {
    using _following = following();
    const tab = serverTab({ tabId: "tab_closing" });
    reconcilePreviewServerSessions(ref, { sessions: [tab], serverEpoch, revision: 1 });
    applyPreviewServerSnapshot(ref, serverTab({ tabId: "tab_own", reveal: undefined }));
    applyPreviewServerSnapshot(ref, { ...serverTab({ tabId: "tab_desktop" }), runtime: "desktop" });
    beginPreviewSessionClose(ref, tab.tabId);
    cancelPreviewSessionClose(ref, tab, tab.tabId);
    expect(panel().isOpen).toBe(false);
    expect(floatingTabId()).toBeNull();
  });

  it("follows background threads and closes the floating browser when its session ends", () => {
    using _following = following();
    const other = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-2"));
    reconcilePreviewServerSessions(other, {
      sessions: [serverTab({ threadId: "thread-2", tabId: "tab_b" })],
      serverEpoch,
      revision: 1,
    });
    expect(browserTabs(scopedThreadKey(other))).toEqual(["browser:tab_b"]);

    reconcilePreviewServerSessions(ref, { sessions: [], serverEpoch, revision: 1 });
    const opened = serverTab();
    applyPreviewServerEvent(ref, {
      type: "opened",
      threadId: "thread-1",
      tabId: opened.tabId,
      createdAt: opened.updatedAt,
      snapshot: opened,
      serverEpoch,
      revision: 2,
    });
    expect(floatingTabId()).toBe("tab_a");
    applyPreviewServerEvent(ref, {
      type: "closed",
      threadId: "thread-1",
      tabId: opened.tabId,
      createdAt: opened.updatedAt,
      serverEpoch,
      revision: 3,
    });
    expect(browserTabs()).toEqual([]);
    expect(floatingTabId()).toBeNull();
  });
});
