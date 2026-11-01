import { EnvironmentId } from "@supaterm/contracts";
import { CameraView } from "expo-camera";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ConnectionsNewRouteScreen } from "./ConnectionsNewRouteScreen";
import type { DevAutoConnectAttempt } from "./devAutoConnect";

type PairingOutcome = { readonly ok: boolean; readonly error: string | null };
const PAIRED: PairingOutcome = { ok: true, error: null };

const state = vi.hoisted(() => ({
  connectionPairingUrl: "",
  connectionPairingUrlListeners: new Set<() => void>(),
  // The app-wide error slot that composer sends and git refreshes also write to.
  pendingConnectionError: null as string | null,
  autoConnectAttempt: null as DevAutoConnectAttempt | null,
  canGoBack: true,
  goBack: vi.fn(),
  dispatch: vi.fn(),
  alert: vi.fn(),
  requestCameraPermission: vi.fn(async () => ({ granted: true })),
  onConnectPress: vi.fn<(url: string, environmentId?: EnvironmentId) => Promise<PairingOutcome>>(),
}));

vi.mock("../../components/ui/ScreenScrollView", () => ({ ScreenScrollView: "ScrollView" }));
vi.mock("expo-camera", () => ({
  CameraView: "CameraView",
  useCameraPermissions: () => [{ granted: true }, state.requestCameraPermission],
}));
vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Error: "error" },
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
}));
vi.mock("@react-navigation/native", () => ({
  StackActions: { replace: (name: string) => ({ type: "REPLACE", payload: { name } }) },
  useIsFocused: () => true,
  useRoute: () => ({ name: "ConnectionsNew" }),
  useNavigation: () => ({
    canGoBack: () => state.canGoBack,
    goBack: state.goBack,
    dispatch: state.dispatch,
    getParent: () => undefined,
    getState: () => ({ index: 0, routes: [{ name: "ConnectionsNew" }] }),
  }),
}));
vi.mock("../workspace/workspace-selection-store", () => ({ workspaceHasColumns: () => false }));
vi.mock("react-native", () => ({
  Alert: { alert: state.alert },
  Linking: {},
  Pressable: "Pressable",
  StyleSheet: { absoluteFill: {} },
  View: "View",
}));
vi.mock("react-native-svg", () => ({
  default: "Svg",
  Defs: "Defs",
  RadialGradient: "RadialGradient",
  Rect: "Rect",
  Stop: "Stop",
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("../../lib/useUniwindTheme", () => ({
  useUniwindTheme: () => ({ "--color-icon": "black" }),
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "light" }),
}));
vi.mock("../settings/components/SettingsScreen", () => ({ SettingsScreen: "SettingsScreen" }));
vi.mock("../../components/ui/AppText", () => ({ AppText: "Text", AppTextInput: "TextInput" }));
vi.mock("../../components/ui/FrostedCutout", () => ({ FrostedCutout: "FrostedCutout" }));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: "SymbolView" }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.autoConnectAttempt }));
vi.mock("../../lib/rootNavigation", () => ({
  rootNavigationRef: {},
  whenRootNavigationReady: vi.fn(),
}));
// React tests compile with `__DEV__` inlined to false; links prefill the form only in dev builds.
vi.mock("./devAutoConnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./devAutoConnect")>()),
  linkedPairingUrl: (pairingUrl: string | undefined) => pairingUrl?.trim() ?? "",
}));
vi.mock("../../state/use-remote-environment-registry", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    state.connectionPairingUrlListeners.add(listener);
    return () => state.connectionPairingUrlListeners.delete(listener);
  };
  return {
    setPendingConnectionError: (message: string | null) => {
      state.pendingConnectionError = message;
    },
    useRemoteConnections: () => ({
      connectionPairingUrl: useSyncExternalStore(subscribe, () => state.connectionPairingUrl),
      connectionError: state.pendingConnectionError,
      onChangeConnectionPairingUrl: setConnectionPairingUrl,
      onConnectPress: state.onConnectPress,
    }),
  };
});

function setConnectionPairingUrl(url: string) {
  state.connectionPairingUrl = url;
  for (const listener of state.connectionPairingUrlListeners) listener();
}

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("__DEV__", false);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.connectionPairingUrl = "";
  state.pendingConnectionError = null;
  state.autoConnectAttempt = null;
  state.canGoBack = true;
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(routeFor?: EnvironmentId) {
  await act(() => {
    renderer = create(<ConnectionsNewRouteScreen route={{ params: { routeFor } }} />);
  });
}

async function openLink(pairingUrl: string) {
  const screen = <ConnectionsNewRouteScreen route={{ params: { pairingUrl } }} />;
  await act(() => {
    if (renderer) renderer.update(screen);
    else renderer = create(screen);
  });
}

function fieldValue(label: "Address" | "Code") {
  return renderer!.root.findByProps({ accessibilityLabel: label }).props.value as string;
}

function shown(text: string) {
  return renderer!.root.findAllByProps({ children: text }).length > 0;
}

function connectAction() {
  return renderer!.root.findByType("SettingsScreen" as never).props.actions[0] as {
    readonly loading: boolean;
    readonly onPress: () => void;
  };
}

function scanner() {
  return renderer!.root.findByType(CameraView).props.onBarcodeScanned as (scan: {
    data: string;
  }) => void;
}

function deferredResult() {
  let resolve!: (result: PairingOutcome) => void;
  const promise = new Promise<PairingOutcome>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const pairingUrl =
  "http://192.168.1.10:3773/pair#token=code&env=machine&routes=https://machine.ts.net";

describe("QR pairing", () => {
  it.each([pairingUrl, `supaterm://pair?pairingUrl=${encodeURIComponent(pairingUrl)}`])(
    "pairs a scanned link immediately and dismisses only after acceptance: %s",
    async (data) => {
      const result = deferredResult();
      state.onConnectPress.mockReturnValue(result.promise);
      await mount();
      const scan = scanner();

      await act(() => {
        scan({ data });
        scan({ data });
      });
      expect(state.onConnectPress).toHaveBeenCalledExactlyOnceWith(pairingUrl, undefined);
      expect(state.goBack).not.toHaveBeenCalled();

      await act(() => scan({ data }));
      expect(state.onConnectPress).toHaveBeenCalledTimes(1);

      await act(() => result.resolve(PAIRED));
      expect(state.goBack).toHaveBeenCalledTimes(1);
    },
  );

  it("opens Home after pairing when there is no previous screen", async () => {
    state.canGoBack = false;
    state.onConnectPress.mockResolvedValue(PAIRED);
    await mount();
    await act(() => scanner()({ data: pairingUrl }));

    expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "REPLACE",
      payload: { name: "Home" },
    });
    expect(state.goBack).not.toHaveBeenCalled();
  });

  it("keeps a failed route pairing open and accepts a fresh scan", async () => {
    const environmentId = EnvironmentId.make("machine");
    const result = deferredResult();
    state.onConnectPress.mockReturnValueOnce(result.promise);
    state.onConnectPress.mockResolvedValue(PAIRED);
    await mount(environmentId);
    await act(() => scanner()({ data: pairingUrl }));

    await act(() =>
      renderer!.root.findByProps({ accessibilityLabel: "Scan QR code" }).props.onPress(),
    );
    expect(state.requestCameraPermission).not.toHaveBeenCalled();

    await act(() => result.resolve({ ok: false, error: "Pairing failed" }));
    expect(state.goBack).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ accessibilityLabel: "Address" }).props.value).toBe(
      "http://192.168.1.10:3773",
    );
    expect(renderer!.root.findByProps({ accessibilityLabel: "Code" }).props.value).toBe("code");

    await act(() =>
      renderer!.root.findByProps({ accessibilityLabel: "Scan QR code" }).props.onPress(),
    );
    const freshPairingUrl = pairingUrl.replace("token=code", "token=fresh-code");
    await act(() => scanner()({ data: freshPairingUrl }));
    expect(state.onConnectPress).toHaveBeenNthCalledWith(1, pairingUrl, environmentId);
    expect(state.onConnectPress).toHaveBeenNthCalledWith(2, freshPairingUrl, environmentId);
    expect(state.goBack).toHaveBeenCalledTimes(1);
  });

  it("shows only its own pairing failure until the code is edited", async () => {
    state.pendingConnectionError = "Could not send the message.";
    state.onConnectPress.mockResolvedValue({ ok: false, error: "Pairing code expired." });
    await mount();
    expect(shown("Could not send the message.")).toBe(false);

    await act(() => scanner()({ data: pairingUrl }));
    expect(shown("Pairing code expired.")).toBe(true);
    expect(shown("Could not send the message.")).toBe(false);

    await act(() =>
      renderer!.root.findByProps({ accessibilityLabel: "Code" }).props.onChangeText("fresh"),
    );
    expect(shown("Pairing code expired.")).toBe(false);

    await act(() => renderer!.unmount());
    renderer = undefined;
    expect(state.pendingConnectionError).toBe("Could not send the message.");
  });

  it("rejects an empty QR code and reopens scanning", async () => {
    vi.useFakeTimers();
    state.onConnectPress.mockResolvedValue(PAIRED);
    await mount();
    await act(() => scanner()({ data: " " }));

    expect(state.onConnectPress).not.toHaveBeenCalled();
    expect(state.alert).toHaveBeenCalledExactlyOnceWith(
      "Invalid QR code",
      "Scanned QR code did not contain a pairing URL.",
    );
    await act(() => {
      vi.advanceTimersByTime(600);
    });
    await act(() => scanner()({ data: pairingUrl }));
    expect(state.goBack).toHaveBeenCalledTimes(1);
  });
});

describe("pairing links", () => {
  const firstLink = "http://first.test/pair#token=old";
  const secondLink = "http://second.test/pair#token=new";

  it("gives a fresh link a clean form after a failed attempt", async () => {
    state.onConnectPress.mockResolvedValue({ ok: false, error: "Old pairing expired." });
    await openLink(firstLink);
    await act(() => connectAction().onPress());
    expect(shown("Old pairing expired.")).toBe(true);

    state.autoConnectAttempt = {
      pairingUrl: secondLink,
      status: "failed",
      error: "New link failed.",
    };
    await openLink(secondLink);
    expect(fieldValue("Address")).toBe("http://second.test");
    expect(fieldValue("Code")).toBe("new");
    expect(shown("Old pairing expired.")).toBe(false);
    expect(shown("New link failed.")).toBe(true);
  });

  it("keeps a replaced link's pending attempt out of the fresh form", async () => {
    const result = deferredResult();
    state.onConnectPress.mockReturnValue(result.promise);
    await openLink(firstLink);
    await act(() => connectAction().onPress());
    expect(connectAction().loading).toBe(true);

    await openLink(secondLink);
    expect(connectAction().loading).toBe(false);

    await act(() => result.resolve({ ok: false, error: "Old pairing expired." }));
    expect(shown("Old pairing expired.")).toBe(false);
    expect(fieldValue("Address")).toBe("http://second.test");
  });

  it("keeps a replaced link's successful pairing from closing or clearing the fresh form", async () => {
    const result = deferredResult();
    state.onConnectPress.mockReturnValue(result.promise);
    await openLink(firstLink);
    await act(() => connectAction().onPress());

    await openLink(secondLink);
    await act(() => {
      // A successful pairing clears the shared draft URL.
      setConnectionPairingUrl("");
      result.resolve(PAIRED);
    });

    expect(fieldValue("Address")).toBe("http://second.test");
    expect(fieldValue("Code")).toBe("new");
    expect(state.goBack).not.toHaveBeenCalled();
    expect(state.dispatch).not.toHaveBeenCalled();
  });
});
