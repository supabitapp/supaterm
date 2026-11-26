import type { ClientSettings } from "@supaterm/contracts";
import { useGT, useMessages } from "gt-react";

import { useClientSettings } from "../../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { SettingsRow, SettingsSection } from "../../settings/settingsLayout";
import { useSearchableSetting } from "../../settings/settingsSearch";
import { updateCodexMicroSettings } from "../updateCodexMicroSettings";
import {
  CODEX_MICRO_AGENT_SOURCE_OPTIONS,
  CODEX_MICRO_ENCODER_MODE_OPTIONS,
  codexMicroEncoderModeOption,
  codexMicroLayoutWithEncoderMode,
  isCodexMicroAgentSource,
  isCodexMicroEncoderMode,
} from "./CodexMicroSettings.logic";

const selectOptionSettings = (settings: ClientSettings) => ({
  agentSource: settings.codexMicro.agentSource,
  layout: settings.codexMicro.layout,
  singleTapFocus: settings.codexMicro.singleTapFocus,
});

function OptionLabel({ label, description }: { label: string; description: string }) {
  return (
    <span className="flex min-w-0 flex-col py-0.5">
      <span>{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </span>
  );
}

export function CodexMicroOptionsSection() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const settings = useClientSettings(selectOptionSettings);
  const agentSource = CODEX_MICRO_AGENT_SOURCE_OPTIONS.find(
    (option) => option.value === settings.agentSource,
  );

  return (
    <SettingsSection id="codex-micro-options" title={gt("Options")}>
      <SettingsRow
        {...searchableSetting("codex-micro-agent-keys")}
        description={gt("Choose what the six agent keys follow or trigger")}
        control={
          <Select
            value={settings.agentSource}
            onValueChange={(value) => {
              if (isCodexMicroAgentSource(value)) {
                void updateCodexMicroSettings({ agentSource: value });
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-52" aria-label={gt("Agent keys")}>
              <SelectValue>{m(agentSource?.label)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {CODEX_MICRO_AGENT_SOURCE_OPTIONS.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  <OptionLabel label={m(option.label)} description={m(option.description)} />
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("codex-micro-knob")}
        description={gt("Choose what turning the knob controls")}
        control={
          <Select
            value={settings.layout.encoderMode}
            onValueChange={(value) => {
              if (isCodexMicroEncoderMode(value)) {
                void updateCodexMicroSettings({
                  layout: codexMicroLayoutWithEncoderMode(settings.layout, value),
                });
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-52" aria-label={gt("Knob")}>
              <SelectValue>
                {m(codexMicroEncoderModeOption(settings.layout.encoderMode).label)}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {CODEX_MICRO_ENCODER_MODE_OPTIONS.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  <OptionLabel label={m(option.label)} description={m(option.description)} />
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("codex-micro-separate-microphone-keys")}
        description={gt("Map the two switches beneath the wide key separately")}
        control={
          <Switch
            checked={settings.layout.separateMicrophoneKeys}
            aria-label={gt("Use separate microphone keys")}
            onCheckedChange={(checked) =>
              void updateCodexMicroSettings({
                layout: { ...settings.layout, separateMicrophoneKeys: checked },
              })
            }
          />
        }
      />
      <SettingsRow
        {...searchableSetting("codex-micro-single-tap-focus")}
        description={gt(
          "Open the assigned thread and bring Supaterm to the front with a single tap instead of a double tap",
        )}
        control={
          <Switch
            checked={settings.singleTapFocus}
            aria-label={gt("Focus Supaterm with a single tap")}
            onCheckedChange={(checked) =>
              void updateCodexMicroSettings({ singleTapFocus: checked })
            }
          />
        }
      />
    </SettingsSection>
  );
}
