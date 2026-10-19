import { getCodexMicroBridge, useCodexMicroDeviceState } from "../../codexMicro/codexMicroStore";
import { Switch } from "../../ui/switch";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SettingsUnavailableGroup,
} from "../settingsLayout";
import { searchableSetting } from "../settingsSearch";
import { CodexMicroConnectionSection } from "./CodexMicroConnectionSection";
import { CodexMicroLayoutSection } from "./CodexMicroLayoutSection";
import { CodexMicroOptionsSection } from "./CodexMicroOptionsSection";

export function CodexMicroSettings() {
  const state = useCodexMicroDeviceState();
  const bridge = getCodexMicroBridge();

  if (bridge === null) {
    return (
      <SettingsPageContainer>
        <SettingsSection id="codex-micro-connection" title="Connection">
          <SettingsUnavailableGroup message="This version of Supaterm can't connect to Codex Micro. Update Supaterm to use it.">
            <SettingsRow
              {...searchableSetting("codex-micro-enabled")}
              control={<Switch checked={false} disabled aria-label="Enable Codex Micro" />}
            />
          </SettingsUnavailableGroup>
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  return (
    <SettingsPageContainer>
      <CodexMicroConnectionSection bridge={bridge} state={state} />
      <CodexMicroLayoutSection state={state} />
      <CodexMicroOptionsSection />
    </SettingsPageContainer>
  );
}
