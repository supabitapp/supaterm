import { ProviderInstanceId, type ServerProvider } from "@supaterm/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@supaterm/contracts/settings";
import { CheckIcon } from "@supaterm/icons";

import {
  systemVoiceLanguage,
  VOICE_LANGUAGE_OPTIONS,
  voiceLanguageLabel,
} from "../../voice/voiceLanguage";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const SYSTEM_LANGUAGE = "system";

function providerName(provider: ServerProvider) {
  return provider.displayName ?? provider.instanceId;
}

function transcriptionStatus(provider: ServerProvider) {
  if (!provider.enabled) return "Off";
  if (provider.transcription?.status === "ready") return "Ready";
  return provider.transcription?.reason === "signedOut" ? "Sign in again" : "Can't transcribe";
}

export function VoiceTranscriptionSettingRow(props: {
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const providers = props.providers.filter((provider) => provider.transcription !== undefined);
  const selectedId = settings.transcriptionProviderInstanceId;
  const selected = providers.find((provider) => provider.instanceId === selectedId);
  return (
    <SettingsRow
      serverScoped
      settingKeys={["transcriptionProviderInstanceId"]}
      {...searchableSetting("voice-transcription")}
      description="Voice input sent to this environment is transcribed with this login, which is charged for it. Supaterm never switches to another account."
      resetAction={
        selectedId !== DEFAULT_UNIFIED_SETTINGS.transcriptionProviderInstanceId ? (
          <SettingResetButton
            label="voice transcription"
            onClick={() =>
              updateSettings({
                transcriptionProviderInstanceId:
                  DEFAULT_UNIFIED_SETTINGS.transcriptionProviderInstanceId,
              })
            }
          />
        ) : null
      }
      control={
        providers.length === 0 ? (
          <span className="text-muted-foreground text-xs">No provider here can transcribe.</span>
        ) : (
          <Select
            value={selectedId}
            onValueChange={(value) => {
              if (value)
                updateSettings({ transcriptionProviderInstanceId: ProviderInstanceId.make(value) });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-auto min-w-0 max-w-full"
              aria-label="Voice transcription provider"
            >
              <SelectValue>{selected ? providerName(selected) : selectedId}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {providers.map((provider) => (
                <SelectItem key={provider.instanceId} value={provider.instanceId}>
                  <span className="flex w-full items-center justify-between gap-4">
                    {providerName(provider)}
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {transcriptionStatus(provider)}
                      {provider.instanceId === selectedId ? <CheckIcon aria-hidden="true" /> : null}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )
      }
    />
  );
}

export function VoiceLanguageSettingRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const value = settings.voiceLanguage ?? SYSTEM_LANGUAGE;
  const systemLabel = `System (${voiceLanguageLabel(systemVoiceLanguage())})`;
  const options = [
    { value: SYSTEM_LANGUAGE, label: systemLabel },
    ...VOICE_LANGUAGE_OPTIONS.map((tag) => ({ value: tag, label: voiceLanguageLabel(tag) })),
  ];
  return (
    <SettingsRow
      {...searchableSetting("voice-language")}
      description="The language you speak for voice input on this device."
      resetAction={
        settings.voiceLanguage !== DEFAULT_UNIFIED_SETTINGS.voiceLanguage ? (
          <SettingResetButton
            label="voice language"
            onClick={() =>
              updateSettings({ voiceLanguage: DEFAULT_UNIFIED_SETTINGS.voiceLanguage })
            }
          />
        ) : null
      }
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            if (next) updateSettings({ voiceLanguage: next === SYSTEM_LANGUAGE ? null : next });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-auto min-w-0 max-w-full"
            aria-label="Voice language"
          >
            <SelectValue>
              {options.find((option) => option.value === value)?.label ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="flex items-center justify-between gap-4">
                  {option.label}
                  {option.value === value ? <CheckIcon aria-hidden="true" /> : null}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
