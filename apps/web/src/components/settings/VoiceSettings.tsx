import {
  automaticTranscriptionProvider,
  ProviderInstanceId,
  type ServerProvider,
} from "@supaterm/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@supaterm/contracts/settings";

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
const AUTOMATIC_TRANSCRIPTION = "@automatic";

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
  const automatic = automaticTranscriptionProvider(providers);
  const options = [
    {
      value: AUTOMATIC_TRANSCRIPTION,
      label: `Automatic (${automatic ? providerName(automatic) : "none"})`,
      status: automatic ? transcriptionStatus(automatic) : "Can't transcribe",
    },
    ...providers.map((provider) => ({
      value: provider.instanceId,
      label: providerName(provider),
      status: transcriptionStatus(provider),
    })),
  ];
  const value = selectedId ?? AUTOMATIC_TRANSCRIPTION;
  return (
    <SettingsRow
      serverScoped
      settingKeys={["transcriptionProviderInstanceId"]}
      {...searchableSetting("voice-transcription")}
      description="Voice input sent to this environment is transcribed with this login, which is charged for it. Automatic uses the first ready login, Claude's first. A login you choose is never swapped for another account."
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
            value={value}
            onValueChange={(next) => {
              if (next)
                updateSettings({
                  transcriptionProviderInstanceId:
                    next === AUTOMATIC_TRANSCRIPTION ? null : ProviderInstanceId.make(next),
                });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-auto min-w-0 max-w-full"
              aria-label="Voice transcription provider"
            >
              <SelectValue>
                {options.find((option) => option.value === value)?.label ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {options.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  <span className="flex w-full items-center justify-between gap-6">
                    {option.label}
                    <span className="text-muted-foreground">{option.status}</span>
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
              <SelectItem hideIndicator key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
