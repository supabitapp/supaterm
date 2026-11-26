import type {
  ClientSettings,
  CodexMicroDeviceState,
  CodexMicroPermissionStatus,
} from "@supaterm/contracts";
import { T, useGT, useMessages } from "gt-react";

import { useClientSettings } from "../../../hooks/useSettings";
import { readLocalApi } from "../../../localApi";
import { cn, isMacPlatform } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { BrightnessSlider } from "../../settings/BrightnessSlider";
import { toastManager } from "../../ui/toast";
import { SettingsRow, SettingsSection } from "../../settings/settingsLayout";
import { searchableSetting } from "../../settings/settingsSearch";
import { updateCodexMicroSettings } from "../updateCodexMicroSettings";
import {
  CODEX_MICRO_AUTO_DIM_LABELS,
  CODEX_MICRO_PERMISSION_LABELS,
  codexMicroConnectionSummary,
  codexMicroDeviceDetails,
  isCodexMicroAutoDim,
  type CodexMicroTone,
} from "./CodexMicroSettings.logic";

const TONE_TEXT_CLASS_NAMES: Readonly<Record<CodexMicroTone, string>> = {
  muted: "text-muted-foreground",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  error: "text-destructive-foreground",
};

const selectConnectionSettings = (settings: ClientSettings) => ({
  enabled: settings.codexMicro.enabled,
  brightness: settings.codexMicro.brightness,
  autoDim: settings.codexMicro.autoDim,
});

const isMacHost = isMacPlatform(navigator.platform);

function InputMonitoringStatus({
  permission,
  onOpenSettings,
}: {
  permission: CodexMicroPermissionStatus;
  onOpenSettings: () => void;
}) {
  const m = useMessages();
  return (
    <>
      <span
        className={cn(
          "text-xs",
          permission === "granted" ? "text-success-foreground" : "text-muted-foreground",
        )}
      >
        {m(CODEX_MICRO_PERMISSION_LABELS[permission])}
      </span>
      {permission === "denied" ? (
        <Button size="sm" variant="outline" onClick={onOpenSettings}>
          <T>Open System Settings</T>
        </Button>
      ) : null}
    </>
  );
}

export function CodexMicroConnectionSection({ state }: { state: CodexMicroDeviceState | null }) {
  const gt = useGT();
  const m = useMessages();
  const settings = useClientSettings(selectConnectionSettings);
  const summary = codexMicroConnectionSummary(settings.enabled, state, m);
  const details = settings.enabled ? codexMicroDeviceDetails(state, m) : null;
  const permission = state?.inputMonitoring ?? null;
  const disabled = !settings.enabled;

  const openInputMonitoringSettings = async () => {
    await readLocalApi()
      ?.shell.openSystemSettings("input-monitoring")
      .catch(() => {
        toastManager.add({
          type: "error",
          title: gt("Couldn't open System Settings"),
          description: gt("Open Privacy & Security, then Input Monitoring, and allow Supaterm."),
        });
      });
  };

  return (
    <SettingsSection
      id="codex-micro-connection"
      title={gt("Connection", { $context: "settings section" })}
    >
      <SettingsRow
        {...searchableSetting("codex-micro-enabled")}
        description={
          summary.description ?? gt("Use the keys, knob, and analog stick to control Supaterm.")
        }
        status={details}
        control={
          <>
            {summary.label ? (
              <span role="status" className={cn("text-xs", TONE_TEXT_CLASS_NAMES[summary.tone])}>
                {summary.label}
              </span>
            ) : null}
            <Switch
              checked={settings.enabled}
              aria-label={gt("Enable Codex Micro")}
              onCheckedChange={(checked) => void updateCodexMicroSettings({ enabled: checked })}
            />
          </>
        }
      />
      {isMacHost ? (
        <SettingsRow
          {...searchableSetting("codex-micro-input-monitoring")}
          description={gt("Required for Codex Micro key presses on macOS")}
          control={
            permission ? (
              <InputMonitoringStatus
                permission={permission}
                onOpenSettings={() => void openInputMonitoringSettings()}
              />
            ) : null
          }
        />
      ) : null}
      <SettingsRow
        {...searchableSetting("codex-micro-brightness")}
        description={gt("Adjusts the brightness of all Codex Micro lighting")}
        aria-disabled={disabled || undefined}
        control={
          <BrightnessSlider
            id="codex-micro-brightness-slider"
            brightness={settings.brightness}
            disabled={disabled}
            onCommit={(brightness) => void updateCodexMicroSettings({ brightness })}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("codex-micro-auto-dim")}
        description={gt(
          "Turns lighting off after inactivity and back on when you use Codex Micro or an agent key changes state",
        )}
        aria-disabled={disabled || undefined}
        control={
          <Select
            value={settings.autoDim}
            disabled={disabled}
            onValueChange={(value) => {
              if (isCodexMicroAutoDim(value)) void updateCodexMicroSettings({ autoDim: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Auto-dim")}>
              <SelectValue>{m(CODEX_MICRO_AUTO_DIM_LABELS[settings.autoDim])}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(CODEX_MICRO_AUTO_DIM_LABELS).map(([value, label]) => (
                <SelectItem hideIndicator key={value} value={value}>
                  {m(label)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
