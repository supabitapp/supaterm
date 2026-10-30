import { EnvironmentId } from "@supaterm/contracts";
import { CameraView } from "expo-camera";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ConnectionsNewRouteScreen } from "./ConnectionsNewRouteScreen";

const state = vi.hoisted(() => ({
  connectionPairingUrl: "",
  pairingConnectionError: null as string | null,
  canGoBack: true,
  goBack: vi.fn(),
  dispatch: vi.fn(),
  alert: vi.fn(),
  requestCameraPermission: vi.fn(async () => ({ granted: true })),
  onConnectPress:
    vi.fn<
      (url: string, environmentId?: EnvironmentId) => Promise<{ ok: boolean; error: string | null }>
    >(),
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("./devAutoConnect", () => ({
  autoConnectReport: () => ({ connecting: false, error: null }),
  devAutoConnectAttemptAtom: {},
}));
vi.mock("../settings/settings-navigation", () => ({ leaveSettingsPage: () => state.goBack() }));
vi.mock("../workspace/workspace-selection-store", () => ({ workspaceHasColumns: () => false }));
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
  }),
}));
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
vi.mock("../../state/use-remote-environment-registry", () => ({
  setPendingConnectionError: (error: string | null) => {
    state.pairingConnectionError = error;
  },
  useRemoteConnections: () => ({
    connectionPairingUrl: state.connectionPairingUrl,
    pairingConnectionError: state.pairingConnectionError,
    onChangeConnectionPairingUrl: (url: string) => {
      state.connectionPairingUrl = url;
    },
    onConnectPress: state.onConnectPress,
  }),
}));

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("__DEV__", false);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.connectionPairingUrl = "";
  state.pairingConnectionError = null;
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

function scanner() {
  return renderer!.root.findByType(CameraView).props.onBarcodeScanned as (scan: {
    data: string;
  }) => void;
}

function deferredResult() {
  let resolve!: (result: { ok: boolean; error: string | null }) => void;
  const promise = new Promise<{ ok: boolean; error: string | null }>((complete) => {
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

      await act(() => result.resolve({ ok: true, error: null }));
      expect(state.goBack).toHaveBeenCalledTimes(1);
    },
  );

  it("opens Home after pairing when there is no previous screen", async () => {
    state.canGoBack = false;
    state.onConnectPress.mockResolvedValue({ ok: true, error: null });
    await mount();
    await act(() => scanner()({ data: pairingUrl }));

    expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "REPLACE",
      payload: { name: "Home" },
    });
    expect(state.goBack).not.toHaveBeenCalled();
  });

  it("leaves automatic pairing to link parsing instead of pairing again on mount", async () => {
    vi.stubGlobal("__DEV__", true);
    await act(() => {
      renderer = create(
        <ConnectionsNewRouteScreen route={{ params: { pairingUrl, autoConnect: "1" } }} />,
      );
    });
    expect(state.onConnectPress).not.toHaveBeenCalled();
  });

  it("keeps a failed route pairing open and accepts a fresh scan", async () => {
    const environmentId = EnvironmentId.make("machine");
    const result = deferredResult();
    state.onConnectPress.mockReturnValueOnce(result.promise);
    state.onConnectPress.mockResolvedValue({ ok: true, error: null });
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

  it("rejects an empty QR code and reopens scanning", async () => {
    vi.useFakeTimers();
    state.onConnectPress.mockResolvedValue({ ok: true, error: null });
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
