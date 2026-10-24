import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@supaterm/contracts";
import type { PushKinds, PushNotificationKind, PushPreviewLevel } from "@supaterm/contracts/push";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { appAtomRegistry } from "../../state/atom-registry";
import { useWorkspaceEnvironments } from "../../state/workspace";
import type { PushDeviceState, PushEnvironmentState } from "../notifications/pushRegistrar";
import { describePushEnvironmentState } from "../notifications/pushStatusText";
import {
  loadPushHideContent,
  loadPushSettings,
  pushCommands,
  pushHideContentAtom,
  pushRegistrar,
  pushSettingsAtom,
  pushStatusAtom,
  setPushHideContent,
} from "../notifications/pushRuntime";
import { SettingsActionRow } from "./components/SettingsActionRow";
import { SettingsChoiceRow } from "./components/SettingsChoiceRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const PREVIEW_OPTIONS: ReadonlyArray<{
  readonly level: PushPreviewLevel;
  readonly label: string;
  readonly description: string;
}> = [
  {
    level: "hidden",
    label: "Hidden",
    description: "Only “Supaterm” and what happened, such as “Approval needed”.",
  },
  {
    level: "titles",
    label: "Titles",
    description: "The thread and project names, without commands or agent output.",
  },
  {
    level: "full",
    label: "Full",
    description: "Also the command to approve, the question, or the agent's last message.",
  },
];

const KIND_OPTIONS: ReadonlyArray<{
  readonly kind: PushNotificationKind;
  readonly label: string;
  readonly description: string;
}> = [
  { kind: "approval", label: "Approvals", description: "An agent is waiting for permission" },
  { kind: "input", label: "Questions", description: "An agent asked you something" },
  { kind: "completion", label: "Finished", description: "A turn completed" },
  { kind: "failure", label: "Failed", description: "A turn stopped with an error" },
  { kind: "usage-limit", label: "Usage limits", description: "A provider limit stopped a turn" },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function SettingsNotificationsRouteScreen() {
  const insets = useSafeAreaInsets();
  const registrar = pushRegistrar();
  const settings = useAtomValue(pushSettingsAtom);
  const status = useAtomValue(pushStatusAtom);
  const hideContent = useAtomValue(pushHideContentAtom);
  const environments = useWorkspaceEnvironments();
  const [draftPreview, setDraftPreview] = useState<PushPreviewLevel>("titles");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadPushHideContent().catch(() => undefined);
    if (appAtomRegistry.get(pushSettingsAtom) === null) {
      void loadPushSettings().catch(() => undefined);
    }
  }, []);

  const enabled = settings?.enabled ?? false;
  const preview = enabled ? (settings?.preview ?? "titles") : draftPreview;
  const kinds = settings?.kinds;

  const run = (operation: () => Promise<unknown>) => {
    setBusy(true);
    void operation()
      .catch((error: unknown) => Dialog.alert("Notifications", errorText(error)))
      .finally(() => setBusy(false));
  };

  const retry = () =>
    run(async () =>
      registrar?.retry({
        saved: new Set(environments.map((environment) => environment.environmentId)),
        connected: new Set(
          environments
            .filter((environment) => environment.connectionState === "connected")
            .map((environment) => environment.environmentId),
        ),
      }),
    );

  const setKind = (kind: PushNotificationKind, value: boolean) => {
    if (!registrar || !kinds) return;
    const next: PushKinds = { ...kinds, [kind]: value };
    run(() => registrar.updatePreferences({ kinds: next }));
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {registrar === null ? (
          <Text className="px-2 text-sm text-foreground-muted">
            Push notifications are not available in this build of Supaterm.
          </Text>
        ) : (
          <>
            <SettingsSection
              title="Push notifications"
              footer="Alerts are encrypted by your environment and decrypted on this device. The notification service only sees that an alert was sent."
            >
              <SettingsSwitchRow
                icon="bell"
                label="Notify me"
                subtitle="Approvals, questions, and finished turns while you are away"
                value={enabled}
                disabled={busy || settings === null}
                onValueChange={(value) =>
                  run(() => (value ? registrar.enable(preview) : registrar.disable()))
                }
              />
            </SettingsSection>
            <DeviceStatus state={status.device} busy={busy} onRetry={retry} />

            <SettingsSection title="Lock screen preview">
              {PREVIEW_OPTIONS.map((option, index) => (
                <SettingsChoiceRow
                  key={option.level}
                  label={option.label}
                  description={option.description}
                  selected={preview === option.level}
                  separated={index > 0}
                  disabled={busy}
                  onPress={() =>
                    enabled
                      ? run(() => registrar.updatePreferences({ preview: option.level }))
                      : setDraftPreview(option.level)
                  }
                />
              ))}
            </SettingsSection>

            {enabled && kinds ? (
              <SettingsSection title="Alerts">
                {KIND_OPTIONS.map((option) => (
                  <SettingsSwitchRow
                    key={option.kind}
                    label={option.label}
                    subtitle={option.description}
                    value={kinds[option.kind]}
                    disabled={busy}
                    onValueChange={(value) => setKind(option.kind, value)}
                  />
                ))}
              </SettingsSection>
            ) : null}

            <SettingsSection
              title="This device"
              footer="Shows only “Supaterm” and what happened, whatever the environment sends."
            >
              <SettingsSwitchRow
                icon="eye.slash"
                label="Hide content on this device"
                value={hideContent ?? false}
                disabled={hideContent === null}
                onValueChange={(value) =>
                  void setPushHideContent(value).catch((error: unknown) =>
                    Dialog.alert("Notifications", errorText(error)),
                  )
                }
              />
            </SettingsSection>

            {enabled && environments.length > 0 ? (
              <SettingsSection title="Environments">
                {environments.map((environment) => (
                  <EnvironmentPushRow
                    key={environment.environmentId}
                    environmentId={environment.environmentId}
                    label={environment.environmentLabel}
                    state={status.environments.get(environment.environmentId)}
                  />
                ))}
              </SettingsSection>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function DeviceStatus(props: {
  readonly state: PushDeviceState;
  readonly busy: boolean;
  readonly onRetry: () => void;
}) {
  switch (props.state.state) {
    case "permission-denied":
      return (
        <SettingsSection>
          <SettingsActionRow
            icon="bell"
            label="Open iOS Settings"
            description="Notifications are off for Supaterm"
            onPress={() => void Linking.openSettings()}
          />
        </SettingsSection>
      );
    case "verifying":
      return <Text className="px-2 text-sm text-foreground-muted">Verifying this device…</Text>;
    case "gateway-unreachable":
    case "error":
      return (
        <SettingsSection>
          <SettingsActionRow
            icon="arrow.clockwise"
            label="Try again"
            description={
              props.state.state === "error"
                ? props.state.message
                : "Cannot reach the notification service"
            }
            loading={props.busy}
            onPress={props.onRetry}
          />
        </SettingsSection>
      );
    default:
      return null;
  }
}

function EnvironmentPushRow(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly state: PushEnvironmentState | undefined;
}) {
  const canTest = useAtomValue(pushCommands.test.permissionAtom(props.environmentId));
  const canRegister = useAtomValue(pushCommands.register.permissionAtom(props.environmentId));
  const [pending, setPending] = useState(false);
  const active = props.state?.state === "active";
  const revoked = props.state?.state === "revoked";

  const sendTest = () => {
    const registrar = pushRegistrar();
    if (!registrar) return;
    setPending(true);
    void registrar
      .sendTest(props.environmentId)
      .then((result) => {
        if (result === "accepted") return;
        Dialog.alert(
          "Test notification",
          result === "gone"
            ? "This device's registration had expired and was set up again. Try once more."
            : "The environment could not deliver the notification. Try again later.",
        );
      })
      .catch((error: unknown) => Dialog.alert("Test notification", errorText(error)))
      .finally(() => setPending(false));
  };

  const turnOnAgain = () => {
    const registrar = pushRegistrar();
    if (!registrar) return;
    setPending(true);
    void registrar
      .resumeEnvironment(props.environmentId)
      .catch((error: unknown) => Dialog.alert("Notifications", errorText(error)))
      .finally(() => setPending(false));
  };

  return (
    <SettingsActionRow
      label={props.label}
      description={describePushEnvironmentState(props.state)}
      detail={active ? "Send test" : revoked ? "Turn on again" : undefined}
      disabled={active ? !canTest : !revoked || !canRegister}
      loading={pending}
      accessibilityHint={
        active
          ? "Sends a test notification to this device"
          : revoked
            ? "Registers this device with the environment again"
            : undefined
      }
      onPress={revoked ? turnOnAgain : sendTest}
    />
  );
}
