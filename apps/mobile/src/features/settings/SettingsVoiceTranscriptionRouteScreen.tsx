import { useAtomValue } from "@effect/atom-react";
import { resolveVoiceTranscriptionSource } from "@supaterm/client-runtime/state/transcription";
import {
  AuthSettingsWriteScope,
  automaticTranscriptionProvider,
  TranscriptionError,
  type ProviderInstanceId,
  type ServerProvider,
} from "@supaterm/contracts";
import { msg, T, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import type { MessageResolver } from "../../i18n/messages";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { resolveMobileSettingsTargets } from "./settings-scoped-server";
import { useSettingsWriter } from "./useSettingsWriter";

function providerStatus(provider: ServerProvider, resolve: MessageResolver): string | null {
  if (!provider.enabled) return resolve(msg("Turned off on this environment."));
  if (provider.transcription?.status !== "ready") {
    return new TranscriptionError({
      reason: provider.transcription?.reason ?? "unsupportedLogin",
    }).message;
  }
  return null;
}

/** Chooses whose account transcribes voice input on each environment, for every device. */
export function SettingsVoiceTranscriptionRouteScreen() {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const environmentMenu = useSettingsEnvironmentMenu();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <SettingsScreen title={gt("Voice transcription")} menus={[environmentMenu]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {selectedTargets.length === 0 ? (
          <Text className="px-2 text-base text-foreground-muted">
            <T>Use the filter above to select a connected environment.</T>
          </Text>
        ) : (
          selectedTargets.map((target) => (
            <EnvironmentTranscriptionSection
              key={target.environmentId}
              target={target}
              title={selectedTargets.length > 1 ? target.label : gt("Transcribe with")}
            />
          ))
        )}
        <Text className="px-2 text-sm text-foreground-muted">
          <T>
            Recordings from every device that uses an environment are transcribed with the account
            chosen here. Automatic uses the first ready login, Claude's first. If an account you
            choose can't transcribe, voice input says why instead of using another account.
          </T>
        </Text>
      </ScrollView>
    </SettingsScreen>
  );
}

function EnvironmentTranscriptionSection(props: {
  readonly target: SettingsTarget;
  readonly title: string;
}) {
  const gt = useGT();
  const m = useMessages();
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
  const automatic = automaticTranscriptionProvider(candidates);
  const note =
    candidates.length === 0
      ? gt(
          "No provider here can transcribe. Update this environment, or sign in to a provider that can.",
        )
      : source.status === "unavailable"
        ? source.message
        : null;
  const choose = (instanceId: ProviderInstanceId | null) => {
    if (saving || !readEnvironmentScope(environmentId, AuthSettingsWriteScope)) return;
    setSaving(true);
    void writeSettings(resolveMobileSettingsTargets([target], null), [
      { environmentId, patch: { transcriptionProviderInstanceId: instanceId } },
    ]).finally(() => setSaving(false));
  };

  return (
    <SettingsSection title={props.title}>
      {candidates.length > 0 ? (
        <SettingsChoiceRow
          label={gt("Automatic", { $context: "transcription account choice" })}
          description={
            automatic && providerStatus(automatic, m) === null
              ? gt("Uses {provider}.", { provider: automatic.displayName ?? automatic.instanceId })
              : gt("No login here is ready.")
          }
          selected={chosen === null}
          disabled={!canWrite || saving}
          onPress={() => {
            if (chosen !== null) choose(null);
          }}
        />
      ) : null}
      {candidates.map((provider) => {
        const status = providerStatus(provider, m);
        const selected = provider.instanceId === chosen;
        return (
          <SettingsChoiceRow
            key={provider.instanceId}
            label={provider.displayName ?? provider.instanceId}
            description={status ?? gt("Ready to transcribe.")}
            selected={selected}
            separated
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
