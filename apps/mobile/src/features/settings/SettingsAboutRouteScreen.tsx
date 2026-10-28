import * as Dialog from "../../components/ui/Dialog";
import { useAtomValue } from "@effect/atom-react";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { availableScratchWorkspaceRoot } from "@supaterm/client-runtime/operations/projects";
import type { EnvironmentId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import Constants from "expo-constants";
import { settlePromise } from "@supaterm/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import {
  type AppUpdateCheckState,
  isAppUpdateCheckAvailable,
  registerHiddenUpdateTap,
  runAppUpdateCheck,
} from "../updates/app-updates";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsActionRow } from "./components/SettingsActionRow";
import type { SettingsTarget } from "./settings-environment-filter";
import { useStartTriage } from "../triage/useStartTriage";
import { Menu } from "../../components/ui/Menu";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";

export function SettingsAboutRouteScreen() {
  const insets = useSafeAreaInsets();

  return (
    <SettingsScreen title="About Supaterm">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <AppSettingsSection />
      </ScrollView>
    </SettingsScreen>
  );
}

function AppSettingsSection() {
  const [updateState, setUpdateState] = useState<AppUpdateCheckState>("idle");
  const updateInFlight = useRef(false);
  const hiddenUpdateTapCount = useRef(0);

  const version = Constants.expoConfig?.version ?? "0.0.0";
  // Fall back to "production" to match resolveAppVariant in app.config.ts, so a
  // missing variant never mislabels a production build as development.
  const variant = (Constants.expoConfig?.extra?.appVariant as string | undefined) ?? "production";
  const variantLabel = variant === "production" ? "" : capitalize(variant);
  const versionLabel = variantLabel ? `${version} · ${variantLabel}` : version;
  const updateCheckAvailable = isAppUpdateCheckAvailable();
  const busy =
    updateState === "checking" || updateState === "downloading" || updateState === "restarting";

  useEffect(() => {
    if (updateState !== "current") return;
    const timer = setTimeout(() => setUpdateState("idle"), 3000);
    return () => clearTimeout(timer);
  }, [updateState]);

  async function checkForUpdate() {
    // `disabled={busy}` only takes effect on the next render, so two taps in the
    // same frame would both get through. The ref closes that window.
    if (updateInFlight.current) return;
    updateInFlight.current = true;

    await settlePromise(() =>
      runAppUpdateCheck({
        applyMode: "immediate",
        onFailure: (message) => Dialog.alert("Update failed", message),
        onStateChange: setUpdateState,
      }),
    );
    updateInFlight.current = false;
  }

  function handleVersionPress() {
    if (!updateCheckAvailable || updateInFlight.current) return;
    const tap = registerHiddenUpdateTap(hiddenUpdateTapCount.current);
    hiddenUpdateTapCount.current = tap.nextCount;
    if (tap.shouldCheck) {
      void checkForUpdate();
    }
  }

  const statusLabel =
    updateState === "checking"
      ? "Checking…"
      : updateState === "downloading"
        ? "Downloading…"
        : updateState === "ready"
          ? "Update ready"
          : updateState === "restarting"
            ? "Restarting…"
            : updateState === "current"
              ? "Up to date"
              : null;

  const versionRow = (
    <View className="flex-row items-center gap-4 p-4">
      <SymbolView
        name="info.circle"
        size={22}
        tintColorClassName="accent-icon"
        type="monochrome"
        weight="regular"
      />
      <Text className="flex-1 text-lg text-foreground">Version</Text>
      <View className="items-end">
        <Text className="text-lg text-foreground-muted">{versionLabel}</Text>
        {statusLabel ? (
          <Text className="text-xs text-foreground-muted/70">{statusLabel}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <SettingsSection title="App">
      <FeedbackSettingsAction />
      <SettingsRow icon="internaldrive" label="Client Storage" target="SettingsClientStorage" />
      <SettingsRow icon="stethoscope" label="Diagnostics" target="SettingsDiagnostics" />
      <SettingsRow
        icon="doc.on.doc"
        label="Open source licenses"
        target="SettingsOpenSourceLicenses"
      />
      <SettingsRow icon="doc.text" label="Legal" fullScreenTarget="SettingsLegal" />
      {updateCheckAvailable ? (
        <Pressable
          accessibilityLabel={`Version ${versionLabel}`}
          accessibilityRole="text"
          disabled={busy}
          onPress={handleVersionPress}
        >
          {versionRow}
        </Pressable>
      ) : (
        versionRow
      )}
    </SettingsSection>
  );
}

function FeedbackSettingsAction() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const { startTriage, isPending } = useStartTriage();
  const capableTargets = environments.filter(
    (target): target is SettingsTarget =>
      target.serverConfig !== null &&
      target.serverConfig.environment.capabilities.triage === true &&
      availableScratchWorkspaceRoot({
        environmentId: target.environmentId,
        connectionPhase: target.connection.phase,
        serverConfig: target.serverConfig,
        projects,
      }) !== null,
  );
  const permissionKey = JSON.stringify(capableTargets.map((target) => target.environmentId));
  const permittedAtom = (() => {
    const ids: readonly EnvironmentId[] = JSON.parse(permissionKey);
    return Atom.make(
      (get) => new Set(ids.filter((id) => get(serverEnvironment.prepareTriage.permissionAtom(id)))),
    );
  })();
  const permitted = useAtomValue(permittedAtom);
  const eligibleTargets = capableTargets.filter((target) => permitted.has(target.environmentId));
  const sendTo = (target: (typeof eligibleTargets)[number]) =>
    void startTriage(target.environmentId);
  const row = (
    <SettingsActionRow
      icon="text.bubble"
      label="Send feedback"
      loading={isPending}
      disabled={eligibleTargets.length === 0 || isPending}
      pointerEvents={eligibleTargets.length > 1 ? "none" : "auto"}
      onPress={() => {
        if (eligibleTargets[0]) sendTo(eligibleTargets[0]);
      }}
    />
  );
  if (eligibleTargets.length < 2) return row;
  return (
    <Menu
      accessible
      accessibilityRole="button"
      accessibilityLabel="Send feedback"
      title="Choose an environment"
      actions={eligibleTargets.map((target) => ({
        id: target.environmentId,
        title: target.label,
        attributes: { disabled: isPending },
      }))}
      onPressAction={({ nativeEvent }) => {
        const target = eligibleTargets.find((entry) => entry.environmentId === nativeEvent.event);
        if (target) sendTo(target);
      }}
    >
      {row}
    </Menu>
  );
}

function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
