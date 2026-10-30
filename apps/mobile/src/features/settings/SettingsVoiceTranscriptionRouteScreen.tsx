import { useAtomValue } from "@effect/atom-react";
import { resolveVoiceTranscriptionSource } from "@supaterm/client-runtime/state/transcription";
import {
  AuthSettingsWriteScope,
  TranscriptionError,
  type ProviderInstanceId,
  type ServerProvider,
} from "@supaterm/contracts";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsChoiceRow } from "./components/SettingsChoiceRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { resolveMobileSettingsTargets } from "./settings-scoped-server";
import { useSettingsWriter } from "./useSettingsWriter";

function providerStatus(provider: ServerProvider): string | null {
  if (!provider.enabled) return "Turned off on this environment.";
  if (provider.transcription?.status !== "ready") {
    return new TranscriptionError({
      reason: provider.transcription?.reason ?? "unsupportedLogin",
    }).message;
  }
  return null;
}

/** Chooses whose account transcribes voice input on each environment, for every device. */
export function SettingsVoiceTranscriptionRouteScreen() {
  const insets = useSafeAreaInsets();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Voice transcription" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedTargets.length === 0 ? (
            <Text className="px-2 text-base text-foreground-muted">
              Use the filter above to select a connected environment.
            </Text>
          ) : (
            selectedTargets.map((target) => (
              <EnvironmentTranscriptionSection
                key={target.environmentId}
                target={target}
                title={selectedTargets.length > 1 ? target.label : "Transcribe with"}
              />
            ))
          )}
          <Text className="px-2 text-sm text-foreground-muted">
            Recordings from every device that uses an environment are transcribed with the account
            chosen here. If it can't transcribe, voice input says why instead of using another
            account.
          </Text>
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function EnvironmentTranscriptionSection(props: {
  readonly target: SettingsTarget;
  readonly title: string;
}) {
  const { target } = props;
  const { environmentId } = target;
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const writeSettings = useSettingsWriter();
  const [saving, setSaving] = useState(false);
  if (!config) return null;

  const chosen = config.settings.transcriptionProviderInstanceId;
  const source = resolveVoiceTranscriptionSource(config);
  const candidates = config.providers.filter((provider) => provider.transcription !== undefined);
  const note =
    candidates.length === 0
      ? "No provider here can transcribe. Update this environment, or sign in to a provider that can."
      : source.status === "unavailable"
        ? source.message
        : null;
  const choose = (instanceId: ProviderInstanceId) => {
    if (saving || !readEnvironmentScope(environmentId, AuthSettingsWriteScope)) return;
    setSaving(true);
    void writeSettings(resolveMobileSettingsTargets([target], null), [
      { environmentId, patch: { transcriptionProviderInstanceId: instanceId } },
    ]).finally(() => setSaving(false));
  };

  return (
    <SettingsSection title={props.title}>
      {candidates.map((provider, index) => {
        const status = providerStatus(provider);
        const selected = provider.instanceId === chosen;
        return (
          <SettingsChoiceRow
            key={provider.instanceId}
            label={provider.displayName ?? provider.instanceId}
            description={status ?? "Ready to transcribe."}
            selected={selected}
            separated={index > 0}
            disabled={!canWrite || saving || (status !== null && !selected)}
            onPress={() => {
              if (!selected) choose(provider.instanceId);
            }}
          />
        );
      })}
      {note !== null ? <Text className="p-4 text-sm text-foreground-muted">{note}</Text> : null}
    </SettingsSection>
  );
}
