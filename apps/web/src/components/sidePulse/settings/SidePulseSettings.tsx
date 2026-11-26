import {
  DEFAULT_CLIENT_SETTINGS,
  SIDE_PULSE_EFFECTS,
  type DesktopSidePulseBridge,
  type SidePulseColor,
  type SidePulseDeviceState,
  type SidePulseEffect,
  type SidePulseEjectGuardStatus,
  type SidePulseLedState,
  type SidePulseSettings as SidePulseSettingsValue,
} from "@supaterm/contracts";
import { sidePulseEffectUsesColor, sidePulseLightColor } from "@supaterm/shared/sidePulsePrograms";
import { msg, T, useGT, useMessages } from "gt-react";
import { useEffect, useState } from "react";

import { useDesktopDeviceState } from "../../../hooks/useDesktopDeviceState";
import { updateClientSettings, useClientSettings } from "../../../hooks/useSettings";
import { m, type MessageResolver } from "../../../i18n/messages";
import { cn, isMacPlatform } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { BrightnessSlider } from "../../settings/BrightnessSlider";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../settings/settingsLayout";
import { searchableSetting } from "../../settings/settingsSearch";
import { getSidePulseBridge } from "../sidePulseBridge";
import { SidePulseColorPicker } from "./SidePulseColorPicker";
import { SidePulseLedPreview } from "./SidePulseLedPreview";

type Tone = "muted" | "success" | "error";

const TONE_TEXT_CLASS_NAMES: Readonly<Record<Tone, string>> = {
  muted: "text-muted-foreground",
  success: "text-success-foreground",
  error: "text-destructive-foreground",
};

const isMacHost = isMacPlatform(navigator.platform);

const DEFAULT_DESCRIPTION = msg("Show what your agents are doing on SidePulse Pro.");

const LIGHTS: ReadonlyArray<{
  readonly state: SidePulseLedState;
  readonly title: string;
  readonly description: string;
}> = [
  {
    state: "attention",
    title: msg("Needs you"),
    description: msg("An agent is waiting for your approval or answer, or failed"),
  },
  {
    state: "working",
    title: msg("Working", { $context: "SidePulse light state" }),
    description: msg("An agent is running"),
  },
  {
    state: "done",
    title: msg("Done", { $context: "SidePulse light state" }),
    description: msg("An agent finished with a reply you have not seen"),
  },
  {
    state: "idle",
    title: msg("Idle", { $context: "SidePulse light state" }),
    description: msg("Nothing needs you"),
  },
];

const EFFECT_LABELS: Readonly<Record<SidePulseEffect, string>> = {
  solid: msg("Solid", { $context: "SidePulse light effect" }),
  breathe: msg("Breathe", { $context: "SidePulse light effect" }),
  pulse: msg("Pulse", { $context: "SidePulse light effect" }),
  heartbeat: msg("Heartbeat", { $context: "SidePulse light effect" }),
  glow: msg("Glow", { $context: "SidePulse light effect" }),
  roll: msg("Roll", { $context: "SidePulse light effect" }),
  ripple: msg("Ripple", { $context: "SidePulse light effect" }),
  scanner: msg("Scanner", { $context: "SidePulse light effect" }),
  twinkle: msg("Twinkle", { $context: "SidePulse light effect" }),
  rainbow: msg("Rainbow", { $context: "SidePulse light effect" }),
  spectrum: msg("Spectrum", { $context: "SidePulse light effect" }),
};

const DEFAULTS = DEFAULT_CLIENT_SETTINGS.sidePulse;

function updateSidePulseSettings(patch: Partial<SidePulseSettingsValue>) {
  return updateClientSettings((current) => ({ sidePulse: { ...current.sidePulse, ...patch } }));
}

function updateSidePulseLight(
  light: SidePulseLedState,
  change: { readonly effect?: SidePulseEffect; readonly color?: SidePulseColor | null },
) {
  return updateClientSettings(({ sidePulse }) => ({
    sidePulse: {
      ...sidePulse,
      effects: { ...sidePulse.effects, [light]: change.effect ?? sidePulse.effects[light] },
      colors: {
        ...sidePulse.colors,
        [light]: change.color === undefined ? sidePulse.colors[light] : change.color,
      },
    },
  }));
}

function EffectSelect({
  label,
  effect,
  onChange,
}: {
  readonly label: string;
  readonly effect: SidePulseEffect;
  readonly onChange: (effect: SidePulseEffect) => void;
}) {
  const messages = useMessages();
  return (
    <Select
      value={effect}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger size="sm" className="w-full sm:w-36" aria-label={label}>
        <SelectValue>{messages(EFFECT_LABELS[effect])}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {SIDE_PULSE_EFFECTS.map((option) => (
          <SelectItem key={option} value={option}>
            {messages(EFFECT_LABELS[option])}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function SidePulseLightRow({
  light,
  settings,
  showing,
  bridge,
}: {
  readonly light: (typeof LIGHTS)[number];
  readonly settings: SidePulseSettingsValue;
  readonly showing: boolean;
  readonly bridge: DesktopSidePulseBridge;
}) {
  const gt = useGT();
  const messages = useMessages();
  const title = messages(light.title);
  const [draftColor, setDraftColor] = useState<SidePulseColor | null>(null);
  const shown =
    draftColor === null
      ? settings
      : { ...settings, colors: { ...settings.colors, [light.state]: draftColor } };
  const effect = settings.effects[light.state];
  const color = sidePulseLightColor(light.state, shown);
  const ownColor = sidePulseLightColor(light.state, DEFAULTS);
  const customized =
    effect !== DEFAULTS.effects[light.state] || settings.colors[light.state] !== null;
  // The LEDs play each pick after it saves, so the device never previews the previous choice.
  const save = (change: Parameters<typeof updateSidePulseLight>[1]) =>
    void updateSidePulseLight(light.state, change)
      .then(() => bridge.preview(light.state))
      .catch(() => undefined);
  const saveColor = (picked: SidePulseColor) => {
    setDraftColor(null);
    save({ color: picked === ownColor ? null : picked });
  };

  return (
    <SettingsRow
      title={title}
      description={messages(light.description)}
      resetAction={
        customized ? (
          <SettingResetButton
            label={gt("{name} light", {
              name: title,
              $context: "setting name in a reset button label",
            })}
            onClick={() => save({ effect: DEFAULTS.effects[light.state], color: null })}
          />
        ) : null
      }
      control={
        <>
          {showing ? (
            <span className="text-xs text-muted-foreground">
              <T>Showing now</T>
            </span>
          ) : null}
          <SidePulseLedPreview ledState={light.state} settings={shown} fallbackColor={color} />
          {sidePulseEffectUsesColor(effect) ? (
            <SidePulseColorPicker
              label={gt("{name} color", { name: title })}
              color={color}
              custom={settings.colors[light.state] !== null}
              onPreview={setDraftColor}
              onCommit={saveColor}
              onClose={() => {
                if (draftColor !== null) saveColor(draftColor);
              }}
              onReset={() => save({ color: null })}
            />
          ) : (
            <span aria-hidden className="size-8 shrink-0 sm:size-7" />
          )}
          <EffectSelect
            label={gt("{name} effect", { name: title })}
            effect={effect}
            onChange={(next) => save({ effect: next })}
          />
        </>
      }
    />
  );
}

function connectionSummary(
  enabled: boolean,
  state: SidePulseDeviceState | null,
  resolve: MessageResolver = m,
): { readonly label: string | null; readonly description: string; readonly tone: Tone } {
  const defaultDescription = resolve(DEFAULT_DESCRIPTION);
  if (!enabled) {
    return {
      label: resolve(msg("Off", { $context: "SidePulse is turned off" })),
      description: defaultDescription,
      tone: "muted",
    };
  }
  if (state === null || !state.enabled) {
    return { label: null, description: defaultDescription, tone: "muted" };
  }
  if (state.devices.length === 0) {
    return {
      label: resolve(msg("Not detected")),
      description: resolve(msg("Insert SidePulse Pro in the SD card slot.")),
      tone: "muted",
    };
  }
  const errors = new Set(state.devices.map((device) => device.error));
  if (errors.has("access-denied")) {
    return {
      label: resolve(msg("No access")),
      description: isMacHost
        ? resolve(
            msg(
              "Allow Supaterm to use removable volumes in System Settings > Privacy & Security > Files & Folders.",
            ),
          )
        : resolve(
            msg(
              "Supaterm can't open the SidePulse volume. Make sure your user can read and write it.",
            ),
          ),
      tone: "error",
    };
  }
  if (errors.has("read-only")) {
    return {
      label: resolve(msg("Can't write")),
      description: resolve(msg("This computer doesn't allow writing to the SidePulse volume.")),
      tone: "error",
    };
  }
  if (errors.has("write-failed")) {
    return {
      label: resolve(msg("Write failed")),
      description: resolve(msg("Supaterm couldn't update the LEDs. It keeps trying.")),
      tone: "error",
    };
  }
  return {
    label: resolve(msg("Connected", { $context: "device connection status" })),
    description: defaultDescription,
    tone: "success",
  };
}

const EJECT_GUARD_DESCRIPTION = msg(
  "macOS ejects SidePulse when a locked Mac wakes from deep sleep. This helper keeps it connected and needs your administrator password.",
);

const INSTALL_COPY = {
  action: msg("Install…"),
  pending: msg("Installing…"),
  failed: msg("Couldn't install the helper. Try again."),
};
const REMOVE_COPY = {
  action: msg("Remove…"),
  pending: msg("Removing…"),
  failed: msg("Couldn't remove the helper. Try again."),
};

function SidePulseEjectGuardRow({ bridge }: { readonly bridge: DesktopSidePulseBridge }) {
  const messages = useMessages();
  const [status, setStatus] = useState<SidePulseEjectGuardStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- reads the helper's install state from the desktop main process once
  useEffect(() => {
    let current = true;
    void bridge.getEjectGuardStatus().then(
      (next) => {
        if (current) setStatus(next);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [bridge]);

  if (status === null || status === "unavailable") return null;
  const installed = status === "installed";
  const copy = installed ? REMOVE_COPY : INSTALL_COPY;
  const toggle = () => {
    setPending(true);
    setFailed(false);
    bridge
      .setEjectGuardInstalled(!installed)
      .then(setStatus, () => setFailed(true))
      .finally(() => setPending(false));
  };

  return (
    <SettingsRow
      {...searchableSetting("sidepulse-eject-guard")}
      description={
        failed ? (
          <span role="alert" className="text-destructive-foreground">
            {messages(copy.failed)}
          </span>
        ) : (
          messages(EJECT_GUARD_DESCRIPTION)
        )
      }
      control={
        <>
          {installed ? (
            <span role="status" className="text-xs text-success-foreground">
              <T>Installed</T>
            </span>
          ) : null}
          <Button
            size="sm"
            variant={installed ? "ghost-muted" : "outline"}
            disabled={pending}
            onClick={toggle}
          >
            {pending ? messages(copy.pending) : messages(copy.action)}
          </Button>
        </>
      }
    />
  );
}

export function SidePulseSettings() {
  const bridge = getSidePulseBridge();
  if (bridge === null) return null;
  return <SidePulseSettingsPage bridge={bridge} />;
}

function SidePulseSettingsPage({ bridge }: { readonly bridge: DesktopSidePulseBridge }) {
  const gt = useGT();
  const messages = useMessages();
  const settings = useClientSettings((current) => current.sidePulse);
  const state = useDesktopDeviceState(bridge);
  const summary = connectionSummary(settings.enabled, state, messages);
  const devices = settings.enabled && state?.enabled ? state.devices : [];
  const showing = devices.length > 0 ? (state?.preview ?? state?.ledState ?? null) : null;

  return (
    <SettingsPageContainer>
      <SettingsSection id="sidepulse-connection" title={gt("Connection")}>
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
                aria-label={gt("Enable SidePulse")}
                onCheckedChange={(checked) => void updateSidePulseSettings({ enabled: checked })}
              />
            </>
          }
        />
        <SettingsRow
          {...searchableSetting("sidepulse-brightness")}
          description={gt("Adjusts the brightness of every SidePulse animation")}
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
        {isMacHost ? <SidePulseEjectGuardRow bridge={bridge} /> : null}
      </SettingsSection>
      <SettingsSection id="sidepulse-lights" title={gt("Lights")}>
        {LIGHTS.map((light) => (
          <SidePulseLightRow
            key={light.state}
            light={light}
            settings={settings}
            showing={showing === light.state}
            bridge={bridge}
          />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
