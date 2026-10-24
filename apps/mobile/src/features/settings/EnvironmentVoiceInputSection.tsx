import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  AuthSettingsWriteScope,
  type DictationSettings,
  type DictationSettingsPatch,
  type DictationSourceDescriptor,
  type EnvironmentId,
} from "@supaterm/contracts";
import { useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text } from "../../components/ui/AppText";
import { dictationAvailability } from "../../state/dictation";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsChoiceRow } from "./components/SettingsChoiceRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const BLOCKED_COPY = {
  unknown: "Connect this environment to set up voice input.",
  unsupported: "Update this environment to use voice input.",
  forbidden: "This connection can't use voice input on this environment.",
} as const;

function sourceDescription(source: DictationSourceDescriptor): string {
  if (!source.eligible) return source.unavailableReason ?? "Can't transcribe right now.";
  return source.accountLabel
    ? `${source.serviceLabel} · ${source.accountLabel}`
    : source.serviceLabel;
}

function voiceInputNote(input: {
  readonly canWrite: boolean;
  readonly settings: DictationSettings;
  readonly sources: ReadonlyArray<DictationSourceDescriptor>;
  readonly chosen: DictationSourceDescriptor | null;
}): string {
  if (!input.canWrite) return "This connection can't change voice input settings.";
  if (input.settings.enabled) {
    if (!input.sources.some((source) => source.eligible)) {
      return "No account here can transcribe. Sign in to Claude or Codex on this environment.";
    }
    if (input.settings.source === null) {
      return "Choose the account that transcribes voice input here.";
    }
    if (input.chosen === null) return "The chosen account is no longer available. Choose another.";
  }
  return "Recordings are sent to the chosen account to transcribe, from every device.";
}

/** Chooses the account this environment transcribes voice input with, for every device. */
export function EnvironmentVoiceInputSection(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const state = useAtomValue(dictationAvailability.environmentStateAtom(environmentId));
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "voice input settings update",
    reportFailure: false,
  });
  const [saving, setSaving] = useState(false);

  if (state.status !== "offered") {
    return (
      <SettingsSection title="Voice input">
        <Text className="p-4 text-sm text-foreground-muted">{BLOCKED_COPY[state.status]}</Text>
      </SettingsSection>
    );
  }
  const { settings, sources } = state.offer;
  const disabled = !canWrite || saving;
  const chosen = sources.find((source) => source.id === settings.source) ?? null;
  const write = async (dictation: DictationSettingsPatch) => {
    if (saving || !readEnvironmentScope(environmentId, AuthSettingsWriteScope)) return;
    setSaving(true);
    const result = await updateSettings({ environmentId, input: { patch: { dictation } } });
    setSaving(false);
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    Dialog.alert(
      "Could not save voice input",
      error instanceof Error ? error.message : "Try again.",
    );
  };
  const note = voiceInputNote({ canWrite, settings, sources, chosen });

  return (
    <>
      <SettingsSection title="Voice input">
        <SettingsSwitchRow
          label="Voice input"
          subtitle="Transcribe recordings from the composer on this environment."
          value={settings.enabled}
          disabled={disabled}
          onValueChange={(enabled) => void write({ enabled })}
        />
        {settings.enabled ? (
          <>
            {sources.map((source) => (
              <SettingsChoiceRow
                key={source.id}
                separated
                label={source.label}
                description={sourceDescription(source)}
                selected={source.id === settings.source}
                disabled={disabled || !source.eligible}
                onPress={() => {
                  if (source.id !== settings.source) void write({ source: source.id });
                }}
              />
            ))}
            {settings.source !== null ? (
              <SettingsChoiceRow
                separated
                label="No account"
                description="Voice input asks you to choose an account."
                selected={false}
                disabled={disabled}
                onPress={() => void write({ source: null })}
              />
            ) : null}
          </>
        ) : null}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">{note}</Text>
    </>
  );
}
