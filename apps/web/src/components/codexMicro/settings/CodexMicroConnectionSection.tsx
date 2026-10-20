import type {
  ClientSettings,
  CodexMicroDeviceState,
  CodexMicroPermissionStatus,
  DesktopCodexMicroBridge,
} from "@supaterm/contracts";
import { settlePromise } from "@supaterm/client-runtime/state/runtime";
import { useState, type CSSProperties } from "react";

import { useClientSettings } from "../../../hooks/useSettings";
import { cn, isMacPlatform } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { toastManager } from "../../ui/toast";
import { SettingsRow, SettingsSection } from "../../settings/settingsLayout";
import { searchableSetting } from "../../settings/settingsSearch";
import { useUpdateCodexMicroSettings } from "../useUpdateCodexMicroSettings";
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
  return (
    <>
      <span
        className={cn(
          "text-xs",
          permission === "granted" ? "text-success-foreground" : "text-muted-foreground",
        )}
      >
        {CODEX_MICRO_PERMISSION_LABELS[permission]}
      </span>
      {permission === "denied" ? (
        <Button size="sm" variant="outline" onClick={onOpenSettings}>
          Open System Settings
        </Button>
      ) : null}
    </>
  );
}

function BrightnessSlider({
  brightness,
  disabled,
  onCommit,
}: {
  brightness: number;
  disabled: boolean;
  onCommit: (brightness: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? brightness;
  const style = {
    "--settings-slider-progress": `${value}%`,
    "--settings-slider-fill-offset": `${0.5 - value / 100}rem`,
  } as CSSProperties;
  // Each write reaches the keyboard through main, so a drag is saved once, when it ends.
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== brightness) onCommit(draft);
  };

  return (
    <div className="flex w-full items-center gap-3 sm:w-52">
      <output
        className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
        htmlFor="codex-micro-brightness-slider"
      >
        {value}%
      </output>
      <input
        aria-label="Brightness"
        className="settings-slider min-w-0 flex-1"
        disabled={disabled}
        id="codex-micro-brightness-slider"
        max={100}
        min={0}
        step={5}
        style={style}
        type="range"
        value={value}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isInteger(next) && next >= 0 && next <= 100) setDraft(next);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  );
}

export function CodexMicroConnectionSection({
  bridge,
  state,
}: {
  bridge: DesktopCodexMicroBridge;
  state: CodexMicroDeviceState | null;
}) {
  const settings = useClientSettings(selectConnectionSettings);
  const updateSettings = useUpdateCodexMicroSettings();
  const summary = codexMicroConnectionSummary(settings.enabled, state);
  const details = settings.enabled ? codexMicroDeviceDetails(state) : null;
  const permission = state?.inputMonitoring ?? null;
  const disabled = !settings.enabled;

  const openInputMonitoringSettings = async () => {
    const result = await settlePromise(() => bridge.openInputMonitoringSettings());
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Couldn't open System Settings",
        description: "Open Privacy & Security, then Input Monitoring, and allow Supaterm.",
      });
    }
  };

  return (
    <SettingsSection id="codex-micro-connection" title="Connection">
      <SettingsRow
        {...searchableSetting("codex-micro-enabled")}
        description={
          summary.description ?? "Use the keys, knob, and analog stick to control Supaterm."
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
              aria-label="Enable Codex Micro"
              onCheckedChange={(checked) => void updateSettings({ enabled: checked })}
            />
          </>
        }
      />
      {isMacHost ? (
        <SettingsRow
          {...searchableSetting("codex-micro-input-monitoring")}
          description="Required for Codex Micro key presses on macOS"
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
        description="Adjusts the brightness of all Codex Micro lighting"
        aria-disabled={disabled || undefined}
        control={
          <BrightnessSlider
            brightness={settings.brightness}
            disabled={disabled}
            onCommit={(brightness) => void updateSettings({ brightness })}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("codex-micro-auto-dim")}
        description="Turns lighting off after inactivity and back on when you use Codex Micro or an agent key changes state"
        aria-disabled={disabled || undefined}
        control={
          <Select
            value={settings.autoDim}
            disabled={disabled}
            onValueChange={(value) => {
              if (isCodexMicroAutoDim(value)) void updateSettings({ autoDim: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Auto-dim">
              <SelectValue>{CODEX_MICRO_AUTO_DIM_LABELS[settings.autoDim]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(CODEX_MICRO_AUTO_DIM_LABELS).map(([value, label]) => (
                <SelectItem hideIndicator key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
