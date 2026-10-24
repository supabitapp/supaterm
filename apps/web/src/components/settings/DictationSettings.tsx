import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_SERVER_SETTINGS, type EnvironmentId } from "@supaterm/contracts";
import { useNavigate } from "@tanstack/react-router";

import { isElectron } from "~/env";
import { isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { dictationAvailability, isDictationCaptureSupported } from "~/state/dictation";

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

const AUTOMATIC_SOURCE_VALUE = "automatic";

export function DictationSettings() {
  const { scope } = useSettingsScope();
  const [environmentId, ...others] = scope.environmentIds;
  return (
    <SettingsSection {...searchableSetting("dictation")}>
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
        description="Record speech in the composer and insert the transcript. Audio is sent to the transcription model below."
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
        description="Threads use their own account when it can transcribe."
        status={view.hasEligibleSource ? view.sourceNote : DICTATION_NO_SOURCE_MESSAGE}
        resetAction={
          settings.source === null ? null : (
            <SettingResetButton
              label="transcription model"
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
                value={settings.source ?? AUTOMATIC_SOURCE_VALUE}
                onValueChange={(value) => {
                  if (value === AUTOMATIC_SOURCE_VALUE) {
                    updateSettings({ dictation: { source: null } });
                    return;
                  }
                  const next = sources.find((source) => source.eligible && source.id === value);
                  if (next) updateSettings({ dictation: { source: next.id } });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-56"
                  aria-label="Transcription model"
                >
                  <SelectValue>
                    {settings.source === null
                      ? "Automatic"
                      : saved
                        ? dictationSourceName(saved)
                        : "Unavailable model"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value={AUTOMATIC_SOURCE_VALUE} className="min-w-64">
                    <div className="grid max-w-80 gap-0.5">
                      <span className="font-medium">Automatic</span>
                      <span className="text-xs leading-4 text-muted-foreground">
                        {view.automaticDescription}
                      </span>
                    </div>
                  </SelectItem>
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
