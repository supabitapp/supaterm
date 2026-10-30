import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import {
  StackActions,
  useIsFocused,
  useNavigation,
  useRoute,
  type StaticScreenProps,
} from "@react-navigation/native";
import type { EnvironmentId } from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "../../lib/cn";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { AppText as Text, AppTextInput, type AppTextInputProps } from "../../components/ui/AppText";
import { FrostedCutout } from "../../components/ui/FrostedCutout";
import { pairingUrlForFields, extractPairingUrlFromQrPayload, parsePairingUrl } from "./pairing";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { SymbolView } from "../../components/ui/AppSymbol";
import { autoConnectReport, devAutoConnectAttemptAtom } from "./devAutoConnect";
import { leaveSettingsPage } from "../settings/settings-navigation";
import { workspaceHasColumns } from "../workspace/workspace-selection-store";
import { settlePromise } from "@supaterm/client-runtime/state/runtime";

type ConnectionsNewRouteParams = {
  readonly mode?: string;
  readonly pairingUrl?: string;
  readonly autoConnect?: string;
  readonly routeFor?: EnvironmentId;
};

export function ConnectionsNewRouteScreen({
  route,
}: StaticScreenProps<ConnectionsNewRouteParams | undefined>) {
  const params = route.params ?? {};

  const routePairingUrl = __DEV__ ? (params.pairingUrl?.trim() ?? "") : "";

  return (
    <PairingForm
      key={routePairingUrl}
      routePairingUrl={routePairingUrl}
      routeFor={params.routeFor}
    />
  );
}

function PairingForm({
  routePairingUrl,
  routeFor,
}: {
  readonly routePairingUrl: string;
  readonly routeFor: EnvironmentId | undefined;
}) {
  const { connectionPairingUrl, onChangeConnectionPairingUrl, onConnectPress } =
    useRemoteConnections();
  const navigation = useNavigation();
  const routeName = useRoute().name;
  const insets = useSafeAreaInsets();
  const [originalPairingUrl, setOriginalPairingUrl] = useState(
    routePairingUrl || connectionPairingUrl,
  );
  const [initialPairing] = useState(() => parsePairingUrl(routePairingUrl || connectionPairingUrl));
  const [hostInput, setHostInput] = useState(initialPairing.host);
  const [codeInput, setCodeInput] = useState(initialPairing.code);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [ownAttempt, setOwnAttempt] = useState(false);
  const autoConnect = autoConnectReport(
    useAtomValue(devAutoConnectAttemptAtom),
    routePairingUrl,
    ownAttempt,
  );
  const connecting = isSubmitting || autoConnect.connecting;
  const pairingConnectionError = submitError ?? autoConnect.error;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const screenFocused = useIsFocused();
  const scannerLockedRef = useRef(false);

  const [scanComplete, setScanComplete] = useState(false);

  const headerIconColor = useUniwindTheme()["--color-icon"];

  const connectDisabled = connecting || hostInput.trim().length === 0;

  const clearError = () => {
    setSubmitError(null);
    setOwnAttempt(true);
  };

  const handleHostChange = (value: string) => {
    const parsed = parsePairingUrl(value);
    if (parsed.code) {
      setOriginalPairingUrl(value.trim());
      setHostInput(parsed.host);
      setCodeInput(parsed.code);
      return;
    }
    setHostInput(value);
    clearError();
  };

  const handleCodeChange = (value: string) => {
    setCodeInput(value);
    clearError();
  };

  const handleScanPress = async () => {
    if (isSubmitting) return;
    const permission = await requestCameraPermission();
    if (permission.granted) {
      scannerLockedRef.current = false;
      setScanComplete(false);
      return;
    }
    if (permission.canAskAgain) return;
    Dialog.alert(
      "Camera access needed",
      "Camera access was denied for this app. Open Settings to enable it.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ],
    );
  };

  const connectAndClose = async (pairingUrl: string) => {
    if (connecting) return;
    setOwnAttempt(true);
    setSubmitError(null);
    setIsSubmitting(true);
    onChangeConnectionPairingUrl(pairingUrl);
    const result = await settlePromise(() => onConnectPress(pairingUrl, routeFor));
    setIsSubmitting(false);
    if (result._tag === "Failure") {
      setSubmitError("Could not connect. Try again.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const outcome = result.value;
    setSubmitError(outcome.error);
    void Haptics.notificationAsync(
      outcome.ok
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
    if (outcome.ok) {
      if (!navigation.canGoBack()) navigation.dispatch(StackActions.replace("Home"));
      else leaveSettingsPage(navigation, workspaceHasColumns(), "SettingsEnvironments");
    }
  };

  const handleQrScan = ({ data }: { readonly data: string }) => {
    if (scannerLockedRef.current || isSubmitting) {
      return;
    }

    scannerLockedRef.current = true;

    try {
      const pairingUrl = extractPairingUrlFromQrPayload(data);
      const { host, code } = parsePairingUrl(pairingUrl);
      setOriginalPairingUrl(pairingUrl);
      setHostInput(host);
      setCodeInput(code);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setScanComplete(true);
      void connectAndClose(pairingUrl);
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Dialog.alert(
        "Invalid QR code",
        error instanceof Error ? error.message : "Scanned QR code was not recognized.",
      );
      setTimeout(() => {
        scannerLockedRef.current = false;
      }, 600);
    }
  };

  const handleSubmit = () =>
    connectAndClose(pairingUrlForFields(hostInput, codeInput, originalPairingUrl));

  return (
    <SettingsScreen
      formSheet={routeName === "ConnectionsNew"}
      title={routeFor ? "Add route" : "Add environment"}
      actions={[
        {
          accessibilityLabel: connecting ? "Connecting" : "Add environment",
          loading: connecting,
          icon: "checkmark",
          tintColor: headerIconColor,
          disabled: connectDisabled,
          onPress: () => {
            void handleSubmit();
          },
        },
      ]}
    >
      <ScrollView
        nestedScrollEnabled
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
        }}
      >
        <View collapsable={false} className="gap-6.5">
          <PairingScanCard
            cameraActive={
              cameraPermission?.granted === true && screenFocused && !scanComplete && !isSubmitting
            }
            onScan={handleQrScan}
            onScanPress={() => {
              void handleScanPress();
            }}
          />

          <View collapsable={false} className="gap-2">
            <Text className="px-4 text-sm font-supaterm-medium text-foreground-muted">
              Or enter it
            </Text>
            <View
              collapsable={false}
              className={cn(
                "overflow-hidden rounded-[26px] border-continuous border bg-grouped-card",
                pairingConnectionError ? "border-danger-foreground" : "border-transparent",
              )}
            >
              <PairingInputRow
                label="Address"
                keyboardType="url"
                placeholder="192.168.1.100:7007"
                value={hostInput}
                onChangeText={handleHostChange}
              />
              <View className="ml-4 border-t border-border-subtle" />
              <PairingInputRow
                label="Code"
                placeholder="Pairing code"
                returnKeyType="go"
                value={codeInput}
                onChangeText={handleCodeChange}
                onSubmitEditing={() => {
                  if (!connectDisabled) void handleSubmit();
                }}
              />
            </View>
            <Text
              accessibilityLiveRegion="polite"
              className={cn(
                "px-4 text-sm leading-normal",
                pairingConnectionError ? "text-danger-foreground" : "text-foreground-muted",
              )}
            >
              {pairingConnectionError ??
                "For machines on your local network or tailnet. The machine keeps its own provider credentials."}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SettingsScreen>
  );
}

const SCAN_CARD_HEIGHT = 250;
const SCAN_RETICLE_SIZE = 150;
const SCAN_RETICLE_TOP = 36;
const SCAN_RETICLE_RADIUS = 28;

function PairingScanCard(props: {
  readonly cameraActive: boolean;
  readonly onScan: (result: { readonly data: string }) => void;
  readonly onScanPress: () => void;
}) {
  const light = useAppearancePreferences().themeAppearance === "light";
  return (
    <Pressable
      accessibilityRole={props.cameraActive ? undefined : "button"}
      accessibilityLabel={props.cameraActive ? undefined : "Scan QR code"}
      disabled={props.cameraActive}
      onPress={props.onScanPress}
      className={cn(
        "overflow-hidden rounded-[26px] border-continuous",
        light ? "bg-white" : "bg-black",
      )}
      style={{ height: SCAN_CARD_HEIGHT }}
    >
      <Svg accessibilityElementsHidden height="100%" style={StyleSheet.absoluteFill} width="100%">
        <Defs>
          <RadialGradient id="pairing-scan-backdrop" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={light ? "#f4f4f5" : "#2e2e2e"} />
            <Stop offset="100%" stopColor={light ? "#d9d9dc" : "#0e0e0e"} />
          </RadialGradient>
        </Defs>
        <Rect fill="url(#pairing-scan-backdrop)" height="100%" width="100%" />
      </Svg>

      {props.cameraActive ? (
        <>
          <CameraView
            active
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={props.onScan}
            style={StyleSheet.absoluteFill}
          />
          <FrostedCutout
            cutoutTop={SCAN_RETICLE_TOP}
            cutoutWidth={SCAN_RETICLE_SIZE}
            cutoutHeight={SCAN_RETICLE_SIZE}
            cutoutRadius={SCAN_RETICLE_RADIUS}
            appearance={light ? "light" : "dark"}
          />
        </>
      ) : null}

      <View
        pointerEvents="none"
        className="absolute inset-x-0 items-center gap-3.5"
        style={{ top: SCAN_RETICLE_TOP }}
      >
        <View
          className={cn(
            "items-center justify-center gap-2 border-continuous border-[3px]",
            light ? "border-black/70" : "border-white/80",
          )}
          style={{
            borderRadius: SCAN_RETICLE_RADIUS,
            height: SCAN_RETICLE_SIZE,
            width: SCAN_RETICLE_SIZE,
          }}
        >
          {props.cameraActive ? null : (
            <>
              <SymbolView
                name="qrcode.viewfinder"
                size={44}
                tintColorClassName={light ? "accent-black/60" : "accent-white/70"}
                type="monochrome"
                weight="light"
              />
              <Text
                className={cn(
                  "font-supaterm-medium text-sm",
                  light ? "text-black/70" : "text-white/80",
                )}
              >
                Tap to scan
              </Text>
            </>
          )}
        </View>
        <Text className={cn("text-center text-sm", light ? "text-black/70" : "text-white/80")}>
          Scan the code from supaterm pair or desktop Connections settings
        </Text>
      </View>
    </Pressable>
  );
}

function PairingInputRow({
  label,
  ...inputProps
}: Omit<AppTextInputProps, "accessibilityLabel" | "className"> & {
  readonly label: string;
}) {
  return (
    <View collapsable={false} className="h-13 flex-row items-center gap-3 px-4">
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="w-20 text-base leading-[23px] text-foreground-muted"
      >
        {label}
      </Text>
      <AppTextInput
        {...inputProps}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        className="min-h-0 flex-1 rounded-none border-0 bg-transparent p-0 text-base leading-[23px]"
      />
    </View>
  );
}
