import type {
  DesktopSidePulseBridge,
  SidePulseDeviceState,
  SidePulseLedState,
  SidePulseSettings as SidePulseSettingsValue,
} from "@supaterm/contracts";

import { useDesktopDeviceState } from "../../../hooks/useDesktopDeviceState";
import { updateClientSettings, useClientSettings } from "../../../hooks/useSettings";
import { cn, isMacPlatform } from "../../../lib/utils";
import { Switch } from "../../ui/switch";
import { BrightnessSlider } from "../../settings/BrightnessSlider";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../../settings/settingsLayout";
import { searchableSetting } from "../../settings/settingsSearch";
import { getSidePulseBridge } from "../sidePulseBridge";
import { SidePulseLedPreview } from "./SidePulseLedPreview";

type Tone = "muted" | "success" | "error";

const TONE_TEXT_CLASS_NAMES: Readonly<Record<Tone, string>> = {
  muted: "text-muted-foreground",
  success: "text-success-foreground",
  error: "text-destructive-foreground",
};

const isMacHost = isMacPlatform(navigator.platform);

const DEFAULT_DESCRIPTION = "Show what your agents are doing on SidePulse Pro.";

const LIGHTS: ReadonlyArray<{
  readonly state: SidePulseLedState;
  readonly title: string;
  readonly description: string;
  readonly color: string;
}> = [
  {
    state: "attention",
    title: "Needs you",
    description: "Amber pulse: an agent is waiting for your approval or answer, or failed",
    color: "#FF3A00",
  },
  {
    state: "working",
    title: "Working",
    description: "Cyan roll: an agent is running",
    color: "#00E5FF",
  },
  {
    state: "done",
    title: "Done",
    description: "Solid green: an agent finished with a reply you have not seen",
    color: "#00FF66",
  },
  {
    state: "idle",
    title: "Idle",
    description: "Dim teal pulse: nothing needs you",
    color: "#006060",
  },
];

function updateSidePulseSettings(patch: Partial<SidePulseSettingsValue>) {
  return updateClientSettings((current) => ({ sidePulse: { ...current.sidePulse, ...patch } }));
}

function connectionSummary(
  enabled: boolean,
  state: SidePulseDeviceState | null,
): { readonly label: string | null; readonly description: string; readonly tone: Tone } {
  if (!enabled) return { label: "Off", description: DEFAULT_DESCRIPTION, tone: "muted" };
  if (state === null || !state.enabled) {
    return { label: null, description: DEFAULT_DESCRIPTION, tone: "muted" };
  }
  if (state.devices.length === 0) {
    return {
      label: "Not detected",
      description: "Insert SidePulse Pro in the SD card slot.",
      tone: "muted",
    };
  }
  const errors = new Set(state.devices.map((device) => device.error));
  if (errors.has("access-denied")) {
    return {
      label: "No access",
      description: isMacHost
        ? "Allow Supaterm to use removable volumes in System Settings > Privacy & Security > Files & Folders."
        : "Supaterm can't open the SidePulse volume. Make sure your user can read and write it.",
      tone: "error",
    };
  }
  if (errors.has("read-only")) {
    return {
      label: "Can't write",
      description: "This computer doesn't allow writing to the SidePulse volume.",
      tone: "error",
    };
  }
  if (errors.has("write-failed")) {
    return {
      label: "Write failed",
      description: "Supaterm couldn't update the LEDs. It keeps trying.",
      tone: "error",
    };
  }
  return { label: "Connected", description: DEFAULT_DESCRIPTION, tone: "success" };
}

export function SidePulseSettings() {
  const bridge = getSidePulseBridge();
  if (bridge === null) return null;
  return <SidePulseSettingsPage bridge={bridge} />;
}

function SidePulseSettingsPage({ bridge }: { readonly bridge: DesktopSidePulseBridge }) {
  const settings = useClientSettings((current) => current.sidePulse);
  const state = useDesktopDeviceState(bridge);
  const summary = connectionSummary(settings.enabled, state);
  const devices = settings.enabled && state?.enabled ? state.devices : [];
  const showing = devices.length > 0 ? (state?.ledState ?? null) : null;

  return (
    <SettingsPageContainer>
      <SettingsSection id="sidepulse-connection" title="Connection">
        <SettingsRow
          {...searchableSetting("sidepulse-enabled")}
          description={summary.description}
          status={devices.length > 0 ? devices.map((device) => device.name).join(", ") : null}
          control={
            <>
              {summary.label ? (
                <span role="status" className={cn("text-xs", TONE_TEXT_CLASS_NAMES[summary.tone])}>
                  {summary.label}
                </span>
              ) : null}
              <Switch
                checked={settings.enabled}
                aria-label="Enable SidePulse"
                onCheckedChange={(checked) => void updateSidePulseSettings({ enabled: checked })}
              />
            </>
          }
        />
        <SettingsRow
          {...searchableSetting("sidepulse-brightness")}
          description="Adjusts the brightness of every SidePulse animation"
          aria-disabled={!settings.enabled || undefined}
          control={
            <BrightnessSlider
              id="sidepulse-brightness-slider"
              brightness={settings.brightness}
              disabled={!settings.enabled}
              onCommit={(brightness) => void updateSidePulseSettings({ brightness })}
            />
          }
        />
      </SettingsSection>
      <SettingsSection id="sidepulse-lights" title="Lights">
        {LIGHTS.map((light) => (
          <SettingsRow
            key={light.state}
            title={light.title}
            description={light.description}
            control={
              <>
                {showing === light.state ? (
                  <span className="text-xs text-muted-foreground">Showing now</span>
                ) : null}
                <SidePulseLedPreview
                  ledState={light.state}
                  brightness={settings.brightness}
                  fallbackColor={light.color}
                />
              </>
            }
          />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
