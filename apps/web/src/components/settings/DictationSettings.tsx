import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_SERVER_SETTINGS, type EnvironmentId } from "@supaterm/contracts";
import { useNavigate } from "@tanstack/react-router";

import { isElectron } from "~/env";
import { isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import {
  dictationAvailability,
  isDictationCaptureSupported,
  useDictationRouting,
  useLocalDictationEnvironmentId,
} from "~/state/dictation";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import {
  DICTATION_NO_SOURCE_MESSAGE,
  dictationSourceName,
  resolveDictationSettingsView,
} from "./DictationSettings.logic";
import { ScopedSwitch } from "./ScopedSwitch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
  SettingsUnavailableGroup,
} from "./settingsLayout";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";
import { searchableSetting } from "./settingsSearch";
import { useUpdateScopedSettings } from "./useScopedSettings";

const AUTOMATIC_ROUTING_VALUE = "automatic";

export function DictationSettings() {
  const { scope } = useSettingsScope();
  const [environmentId, ...others] = scope.environmentIds;
  return (
    <SettingsSection {...searchableSetting("dictation")}>
      <DictationRoutingSetting />
      {environmentId !== undefined && others.length === 0 ? (
        <DictationEnvironmentSettings key={environmentId} environmentId={environmentId} />
      ) : (
        <DictationEnvironmentChooser />
      )}
    </SettingsSection>
  );
}

function DictationEnvironmentChooser() {
  const { environments, selectScope } = useSettingsScope();
  if (environments.length === 0) {
    return (
      <SettingsRow title="Dictation" description="Connect an environment to set up dictation." />
    );
  }
  return (
    <SettingsRow
      title="Dictation"
      description="Dictation is set for each environment. Choose one to configure it."
      control={
        <Select
          value={null}
          onValueChange={(value) => {
            const environment = environments.find((entry) => entry.environmentId === value);
            if (environment) selectScope({ machine: environment.environmentId });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-48" aria-label="Dictation environment">
            <SelectValue>Choose environment</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {environments.map((environment) => (
              <SelectItem
                hideIndicator
                key={environment.environmentId}
                value={environment.environmentId}
              >
                {settingsScopeEnvironmentLabel(environment, environments)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function DictationRoutingSetting() {
  const { environments } = useSettingsScope();
  const [routing, setRouting] = useDictationRouting();
  const localEnvironmentId = useLocalDictationEnvironmentId();
  if (environments.length < 2 && routing.mode === "automatic") return null;
  const localLabel =
    localEnvironmentId === null
      ? null
      : (environments.find((environment) => environment.environmentId === localEnvironmentId)
          ?.label ?? null);
  const pinned =
    routing.mode === "pinned"
      ? environments.find((environment) => environment.environmentId === routing.environmentId)
      : undefined;
  const automaticDescription = localLabel
    ? `${localLabel} when it has an account set up, otherwise the thread's environment.`
    : "The thread's environment.";
  return (
    <SettingsRow
      {...searchableSetting("dictation-routing")}
      description="Which environment transcribes voice input from this device. This applies only to this device."
      status={
        routing.mode === "pinned" && pinned === undefined
          ? "The chosen environment isn't connected. Voice input waits for it."
          : null
      }
      control={
        <Select
          value={routing.mode === "pinned" ? routing.environmentId : AUTOMATIC_ROUTING_VALUE}
          onValueChange={(value) => {
            if (value === AUTOMATIC_ROUTING_VALUE) {
              setRouting({ mode: "automatic" });
              return;
            }
            const environment = environments.find((entry) => entry.environmentId === value);
            if (environment) {
              setRouting({ mode: "pinned", environmentId: environment.environmentId });
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Transcribe on">
            <SelectValue>
              {routing.mode === "automatic"
                ? "Automatic"
                : pinned
                  ? settingsScopeEnvironmentLabel(pinned, environments)
                  : "Disconnected environment"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value={AUTOMATIC_ROUTING_VALUE} className="min-w-64">
              <div className="grid max-w-80 gap-0.5">
                <span className="font-medium">Automatic</span>
                <span className="text-xs leading-4 text-muted-foreground">
                  {automaticDescription}
                </span>
              </div>
            </SelectItem>
            {environments.map((environment) => (
              <SelectItem key={environment.environmentId} value={environment.environmentId}>
                {settingsScopeEnvironmentLabel(environment, environments)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function openMicrophoneSettings() {
  void readLocalApi()
    ?.shell.openSystemSettings("microphone")
    .catch(() => {
      toastManager.add({
        type: "error",
        title: "Could not open System Settings",
        description: "Open Privacy & Security → Microphone manually.",
      });
    });
}

function DictationEnvironmentSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const view = resolveDictationSettingsView(
    useAtomValue(dictationAvailability.environmentStateAtom(environmentId)),
  );
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  if (view.kind === "blocked") {
    return <SettingsRow title="Dictation" description={view.message} />;
  }
  const { settings, sources, saved } = view;
  const canOpenMicrophoneSettings =
    isElectron &&
    window.desktopBridge?.openSystemSettings !== undefined &&
    isMacPlatform(navigator.platform);

  return (
    <SettingsUnavailableGroup
      message={
        isDictationCaptureSupported() ? undefined : "Microphone access requires HTTPS or localhost."
      }
    >
      <SettingsRow
        title="Dictation"
        serverScoped
        description="Record speech in the composer and insert the transcript. Audio is sent to the account below."
        status={view.status}
        resetAction={
          settings.enabled === DEFAULT_SERVER_SETTINGS.dictation.enabled ? null : (
            <SettingResetButton
              label="dictation"
              onClick={() =>
                updateSettings({
                  dictation: { enabled: DEFAULT_SERVER_SETTINGS.dictation.enabled },
                })
              }
            />
          )
        }
        control={
          <ScopedSwitch
            settingKeys={["dictation"]}
            checked={settings.enabled}
            aria-label="Dictation"
            onCheckedChange={(checked) =>
              updateSettings({ dictation: { enabled: Boolean(checked) } })
            }
          />
        }
      />
      <SettingsRow
        {...searchableSetting("dictation-source")}
        serverScoped
        description="The account that transcribes voice input on this environment. Your recording is sent to it."
        status={view.hasEligibleSource ? view.sourceNote : DICTATION_NO_SOURCE_MESSAGE}
        resetAction={
          settings.source === null ? null : (
            <SettingResetButton
              label="transcription account"
              onClick={() => updateSettings({ dictation: { source: null } })}
            />
          )
        }
        control={
          <>
            {view.hasEligibleSource ? null : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void navigate({ to: "/settings/providers" })}
              >
                Open Providers
              </Button>
            )}
            {sources.length > 0 ? (
              <Select
                disabled={!settings.enabled}
                value={settings.source}
                onValueChange={(value) => {
                  const next = sources.find((source) => source.eligible && source.id === value);
                  if (next) updateSettings({ dictation: { source: next.id } });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-56"
                  aria-label="Transcription account"
                >
                  <SelectValue>
                    {settings.source === null
                      ? "Choose an account"
                      : saved
                        ? dictationSourceName(saved)
                        : "Unavailable account"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {sources.map((source) => (
                    <SelectItem
                      key={source.id}
                      value={source.id}
                      disabled={!source.eligible}
                      className="min-w-64"
                    >
                      <div className="grid max-w-80 gap-0.5">
                        <span className="font-medium">{source.label}</span>
                        <span className="text-xs leading-4 text-muted-foreground">
                          {source.eligible
                            ? source.accountLabel
                              ? `${source.serviceLabel} · ${source.accountLabel}`
                              : source.serviceLabel
                            : (source.unavailableReason ?? "Can't transcribe right now.")}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
          </>
        }
      />
      {canOpenMicrophoneSettings ? (
        <SettingsRow
          title="Microphone access"
          description="Supaterm asks the first time you dictate. Change it later in System Settings."
          control={
            <Button size="sm" variant="outline" onClick={openMicrophoneSettings}>
              Open microphone settings
            </Button>
          }
        />
      ) : null}
    </SettingsUnavailableGroup>
  );
}
