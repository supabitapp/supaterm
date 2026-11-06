import {
  automaticTranscriptionProvider,
  ProviderInstanceId,
  type ServerProvider,
} from "@supaterm/contracts";
import {
  DEFAULT_TRANSCRIPTION_DICTIONARY,
  DEFAULT_UNIFIED_SETTINGS,
  TRANSCRIPTION_DICTIONARY_MAX_ALIASES,
  TRANSCRIPTION_DICTIONARY_MAX_ENTRIES,
  type TranscriptionDictionaryEntry,
  type VoiceMicrophone,
} from "@supaterm/contracts/settings";
import { PlusIcon, XIcon } from "@supaterm/icons";
import * as Equal from "effect/Equal";
import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  labelsHidden,
  labelsShowTransport,
  listMicrophoneInputs,
  type MicrophoneInput,
  type MicrophonePreference,
  type MicrophoneRoute,
  namedMicrophones,
  resolveMicrophone,
} from "../../voice/microphone";
import {
  systemVoiceLanguage,
  voiceLanguageLabel,
  voiceLanguageOptions,
} from "../../voice/voiceLanguage";
import { isMacPlatform } from "../../lib/utils";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const SYSTEM_LANGUAGE = "system";
const AUTOMATIC_TRANSCRIPTION = "@automatic";
const SYSTEM_MICROPHONE = "@system";

function providerName(provider: ServerProvider) {
  return provider.displayName ?? provider.instanceId;
}

function transcriptionStatus(provider: ServerProvider) {
  if (!provider.enabled) return "Off";
  if (provider.transcription?.status === "ready") return "Ready";
  return provider.transcription?.reason === "signedOut" ? "Sign in again" : "Can't transcribe";
}

function VoiceTranscriptionSettingRow(props: {
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

function VoiceLanguageSettingRow(props: { readonly providers: ReadonlyArray<ServerProvider> }) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const value = settings.voiceLanguage ?? SYSTEM_LANGUAGE;
  const transcriber = props.providers.find(
    (provider) => provider.instanceId === settings.transcriptionProviderInstanceId,
  );
  const systemLabel = `System (${voiceLanguageLabel(systemVoiceLanguage())})`;
  const options = [
    { value: SYSTEM_LANGUAGE, label: systemLabel },
    ...voiceLanguageOptions(transcriber?.driver)
      .map((tag) => ({ value: tag, label: voiceLanguageLabel(tag) }))
      .toSorted((left, right) => left.label.localeCompare(right.label)),
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
              {options.find((option) => option.value === value)?.label ?? voiceLanguageLabel(value)}
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

function VoiceHoldToTalkSettingRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const isMac = isMacPlatform(navigator.platform);
  const options = [
    { value: "alt", label: isMac ? "Option" : "Alt", display: isMac ? "⌥ Option" : "Alt" },
    { value: "space", label: "Space", display: "Space" },
    { value: "off", label: "Off", display: "Off" },
  ] as const;
  return (
    <SettingsRow
      {...searchableSetting("voice-hold-to-talk")}
      description="Hold this key in the composer or a comment field to talk, and let go to stop."
      resetAction={
        settings.voiceHoldToTalkKey !== DEFAULT_UNIFIED_SETTINGS.voiceHoldToTalkKey ? (
          <SettingResetButton
            label="hold to talk"
            onClick={() =>
              updateSettings({ voiceHoldToTalkKey: DEFAULT_UNIFIED_SETTINGS.voiceHoldToTalkKey })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.voiceHoldToTalkKey}
          onValueChange={(value) => {
            const option = options.find((option) => option.value === value);
            if (option) updateSettings({ voiceHoldToTalkKey: option.value });
          }}
        >
          <SelectTrigger size="sm" className="w-auto min-w-0 max-w-full" aria-label="Hold to talk">
            <SelectValue>
              {options.find((option) => option.value === settings.voiceHoldToTalkKey)?.display}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem
                hideIndicator
                key={option.value}
                value={option.value}
                label={option.label}
              >
                {option.display}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

type MicrophoneListing =
  | { readonly kind: "unsupported" | "loading" | "failed" | "none" }
  | { readonly kind: "labelsHidden"; readonly accessDenied: boolean }
  | { readonly kind: "listed"; readonly inputs: ReadonlyArray<MicrophoneInput> };

interface MicrophoneList {
  readonly listing: MicrophoneListing;
  readonly askForAccess: () => void;
}

function listingOf(inputs: ReadonlyArray<MicrophoneInput>): MicrophoneListing {
  if (inputs.length === 0) return { kind: "none" };
  if (labelsHidden(inputs)) return { kind: "labelsHidden", accessDenied: false };
  return { kind: "listed", inputs };
}

/** Only the latest request may land, so a slow listing never replaces a newer one. */
function refreshListing(
  latest: { current: number },
  setListing: (next: MicrophoneListing) => void,
) {
  const request = ++latest.current;
  void listMicrophoneInputs()
    .then(listingOf, (): MicrophoneListing => ({ kind: "failed" }))
    .then((next) => {
      if (request === latest.current) setListing(next);
    });
}

function useMicrophoneList(): MicrophoneList {
  const supported =
    window.isSecureContext && typeof navigator.mediaDevices?.enumerateDevices === "function";
  const [listing, setListing] = useState<MicrophoneListing>({
    kind: supported ? "loading" : "unsupported",
  });
  const latestRequest = useRef(0);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Follows the browser's inputs as microphones connect and disconnect.
  useEffect(() => {
    if (!supported) return;
    const refresh = () => refreshListing(latestRequest, setListing);
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      latestRequest.current += 1;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, [supported]);
  const askForAccess = () => {
    void navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (stream) => {
        for (const track of stream.getTracks()) track.stop();
        refreshListing(latestRequest, setListing);
      },
      () => {
        latestRequest.current += 1;
        setListing({ kind: "labelsHidden", accessDenied: true });
      },
    );
  };
  return { listing, askForAccess };
}

function microphoneDescription(chosen: VoiceMicrophone | null, route: MicrophoneRoute | null) {
  if (chosen && route?.chosenMissing) {
    return `${chosen.label} isn't connected, so voice input uses the system default.`;
  }
  if (route?.passedOver && route.input) {
    return `${route.passedOver.label} is Bluetooth, so voice input uses ${route.input.label}.`;
  }
  return "The microphone voice input records from on this device.";
}

function selectedMicrophone(chosen: VoiceMicrophone | null, route: MicrophoneRoute) {
  if (chosen === null) return SYSTEM_MICROPHONE;
  if (route.chosenMissing || !route.input) return chosen.deviceId;
  return route.input.deviceId;
}

function MicrophoneSelect(props: {
  readonly inputs: ReadonlyArray<MicrophoneInput>;
  readonly preference: MicrophonePreference;
  readonly onChoose: (microphone: VoiceMicrophone | null) => void;
}) {
  const { chosen } = props.preference;
  const route = resolveMicrophone(props.inputs, props.preference);
  const systemInput = resolveMicrophone(props.inputs, { ...props.preference, chosen: null }).input;
  const microphones = namedMicrophones(props.inputs);
  const options = [
    { value: SYSTEM_MICROPHONE, label: "System default", detail: systemInput?.label ?? null },
    ...microphones.map((input) => ({ value: input.deviceId, label: input.label, detail: null })),
    ...(chosen && route.chosenMissing
      ? [{ value: chosen.deviceId, label: chosen.label, detail: "Not connected" }]
      : []),
  ];
  const value = selectedMicrophone(chosen, route);
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === SYSTEM_MICROPHONE) {
          props.onChoose(null);
          return;
        }
        const input = microphones.find((microphone) => microphone.deviceId === next);
        if (input) props.onChoose({ deviceId: input.deviceId, label: input.label });
      }}
    >
      <SelectTrigger size="sm" className="w-auto min-w-0 max-w-full" aria-label="Microphone">
        <SelectValue>{options.find((option) => option.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem hideIndicator key={option.value} value={option.value} label={option.label}>
            <span className="flex w-full items-center justify-between gap-6">
              {option.label}
              {option.detail ? (
                <span className="text-muted-foreground">{option.detail}</span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function VoiceMicrophoneSettingRow(props: { readonly microphones: MicrophoneList }) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { listing, askForAccess } = props.microphones;
  const preference = {
    chosen: settings.voiceMicrophone,
    avoidBluetooth: settings.voiceAvoidBluetoothMicrophone,
  };
  const route = listing.kind === "listed" ? resolveMicrophone(listing.inputs, preference) : null;
  const unlistedControls = {
    unsupported: <span className="text-muted-foreground text-xs">Needs HTTPS or localhost.</span>,
    loading: null,
    failed: <span className="text-muted-foreground text-xs">Couldn't list microphones.</span>,
    none: <span className="text-muted-foreground text-xs">No microphone found.</span>,
    labelsHidden: (
      <Button size="xs" variant="outline" onClick={askForAccess}>
        Show microphones
      </Button>
    ),
  };
  return (
    <SettingsRow
      {...searchableSetting("voice-microphone")}
      description={
        listing.kind === "labelsHidden" && listing.accessDenied
          ? "Microphone access is blocked. Allow it in your browser or system settings."
          : microphoneDescription(preference.chosen, route)
      }
      resetAction={
        preference.chosen !== DEFAULT_UNIFIED_SETTINGS.voiceMicrophone ? (
          <SettingResetButton
            label="microphone"
            onClick={() =>
              updateSettings({ voiceMicrophone: DEFAULT_UNIFIED_SETTINGS.voiceMicrophone })
            }
          />
        ) : null
      }
      control={
        listing.kind === "listed" ? (
          <MicrophoneSelect
            inputs={listing.inputs}
            preference={preference}
            onChoose={(voiceMicrophone) => updateSettings({ voiceMicrophone })}
          />
        ) : (
          unlistedControls[listing.kind]
        )
      }
    />
  );
}

function VoiceAvoidBluetoothSettingRow(props: { readonly microphones: MicrophoneList }) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { listing } = props.microphones;
  if (!isMacPlatform(navigator.platform)) return null;
  if (listing.kind !== "listed" || !labelsShowTransport(listing.inputs)) return null;
  return (
    <SettingsRow
      {...searchableSetting("voice-avoid-bluetooth")}
      description="Keeps AirPods and other headsets out of call-quality audio when one is the system default. A microphone you choose is always used."
      control={
        <Switch
          checked={settings.voiceAvoidBluetoothMicrophone}
          onCheckedChange={(checked) => updateSettings({ voiceAvoidBluetoothMicrophone: checked })}
          aria-label="Use the Mac's microphone instead of Bluetooth"
        />
      }
    />
  );
}

const DICTIONARY_WORD_MAX_LENGTH = 50;

function parseHeardAs(value: string): ReadonlyArray<string> {
  const aliases = value
    .split(",")
    .map((alias) => alias.trim().slice(0, DICTIONARY_WORD_MAX_LENGTH))
    .filter((alias) => alias.length > 0);
  return [...new Set(aliases)].slice(0, TRANSCRIPTION_DICTIONARY_MAX_ALIASES);
}

function VoiceDictionarySettingRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const dictionary = settings.transcriptionDictionary;
  const [term, setTerm] = useState("");
  const [heardAs, setHeardAs] = useState("");
  const full = dictionary.length >= TRANSCRIPTION_DICTIONARY_MAX_ENTRIES;
  const save = (transcriptionDictionary: ReadonlyArray<TranscriptionDictionaryEntry>) =>
    updateSettings({ transcriptionDictionary });
  const add = (event: FormEvent) => {
    event.preventDefault();
    const word = term.trim();
    if (word.length === 0 || full) return;
    const entry = { term: word, aliases: parseHeardAs(heardAs) };
    save([
      ...dictionary.filter((existing) => existing.term.toLowerCase() !== word.toLowerCase()),
      entry,
    ]);
    setTerm("");
    setHeardAs("");
  };
  return (
    <SettingsRow
      serverScoped
      settingKeys={["transcriptionDictionary"]}
      {...searchableSetting("voice-dictionary")}
      description="Words voice input should spell your way, such as names and jargon. Add what the transcript gets instead, so it is corrected."
      resetAction={
        Equal.equals(dictionary, DEFAULT_TRANSCRIPTION_DICTIONARY) ? null : (
          <SettingResetButton
            label="dictionary"
            onClick={() => save(DEFAULT_TRANSCRIPTION_DICTIONARY)}
          />
        )
      }
    >
      <div className="flex flex-col gap-1.5 pt-3 pb-2">
        {dictionary.map((entry) => (
          <div key={entry.term} className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate text-foreground">{entry.term}</span>
            {entry.aliases.length > 0 ? (
              <span className="truncate text-xs text-muted-foreground">
                heard as {entry.aliases.join(", ")}
              </span>
            ) : null}
            <Button
              className="ml-auto"
              variant="ghost-muted"
              size="icon-sm"
              aria-label={`Remove ${entry.term}`}
              onClick={() => save(dictionary.filter((existing) => existing !== entry))}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <form className="flex flex-wrap items-center gap-2" onSubmit={add}>
          <Input
            size="sm"
            className="w-40"
            aria-label="Word"
            placeholder="Word"
            maxLength={DICTIONARY_WORD_MAX_LENGTH}
            value={term}
            disabled={full}
            onChange={(event) => setTerm(event.target.value)}
          />
          <Input
            size="sm"
            className="min-w-40 flex-1"
            aria-label="Heard as"
            placeholder="Heard as, comma separated (optional)"
            value={heardAs}
            disabled={full}
            onChange={(event) => setHeardAs(event.target.value)}
          />
          <Button
            type="submit"
            variant="ghost-muted"
            size="compact"
            disabled={full || term.trim().length === 0}
          >
            <PlusIcon />
            Add word
          </Button>
        </form>
        {full ? (
          <p className="text-xs text-muted-foreground">
            Up to {TRANSCRIPTION_DICTIONARY_MAX_ENTRIES} words
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}

export function VoiceSettingsPanel() {
  const { environment } = useSettingsScope();
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const microphones = useMicrophoneList();
  return (
    <SettingsPageContainer>
      <SettingsSection id="voice-input" title="Voice input">
        <VoiceTranscriptionSettingRow providers={serverProviders} />
        <VoiceLanguageSettingRow providers={serverProviders} />
        <VoiceMicrophoneSettingRow microphones={microphones} />
        <VoiceAvoidBluetoothSettingRow microphones={microphones} />
        <VoiceHoldToTalkSettingRow />
      </SettingsSection>
      <SettingsSection id="voice-transcript" title="Transcript">
        <VoiceDictionarySettingRow />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
