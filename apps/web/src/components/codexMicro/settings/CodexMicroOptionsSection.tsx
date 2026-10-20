import type { ClientSettings } from "@supaterm/contracts";

import { useClientSettings } from "../../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { SettingsRow, SettingsSection } from "../../settings/settingsLayout";
import { searchableSetting } from "../../settings/settingsSearch";
import { useUpdateCodexMicroSettings } from "../useUpdateCodexMicroSettings";
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
  const settings = useClientSettings(selectOptionSettings);
  const updateSettings = useUpdateCodexMicroSettings();
  const agentSource = CODEX_MICRO_AGENT_SOURCE_OPTIONS.find(
    (option) => option.value === settings.agentSource,
  );

  return (
    <SettingsSection id="codex-micro-options" title="Options">
      <SettingsRow
        {...searchableSetting("codex-micro-agent-keys")}
        description="Choose what the six agent keys follow or trigger"
        control={
          <Select
            value={settings.agentSource}
            onValueChange={(value) => {
              if (isCodexMicroAgentSource(value)) {
                void updateSettings({ agentSource: value });
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Agent keys">
              <SelectValue>{agentSource?.label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {CODEX_MICRO_AGENT_SOURCE_OPTIONS.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  <OptionLabel label={option.label} description={option.description} />
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("codex-micro-knob")}
        description="Choose what turning the knob controls"
        control={
          <Select
            value={settings.layout.encoderMode}
            onValueChange={(value) => {
              if (isCodexMicroEncoderMode(value)) {
                void updateSettings({
                  layout: codexMicroLayoutWithEncoderMode(settings.layout, value),
                });
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Knob">
              <SelectValue>
                {codexMicroEncoderModeOption(settings.layout.encoderMode).label}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {CODEX_MICRO_ENCODER_MODE_OPTIONS.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  <OptionLabel label={option.label} description={option.description} />
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("codex-micro-separate-microphone-keys")}
        description="Map the two switches beneath the wide key separately"
        control={
          <Switch
            checked={settings.layout.separateMicrophoneKeys}
            aria-label="Use separate microphone keys"
            onCheckedChange={(checked) =>
              void updateSettings({
                layout: { ...settings.layout, separateMicrophoneKeys: checked },
              })
            }
          />
        }
      />
      <SettingsRow
        {...searchableSetting("codex-micro-single-tap-focus")}
        description="Open the assigned thread and bring Supaterm to the front with a single tap instead of a double tap"
        control={
          <Switch
            checked={settings.singleTapFocus}
            aria-label="Focus Supaterm with a single tap"
            onCheckedChange={(checked) => void updateSettings({ singleTapFocus: checked })}
          />
        }
      />
    </SettingsSection>
  );
}
