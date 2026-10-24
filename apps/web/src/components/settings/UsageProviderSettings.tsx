import type { EnvironmentId } from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function UsageProviderSettings({
  environmentId,
  cursorKeychainUsageEnabled,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly cursorKeychainUsageEnabled: boolean;
  readonly readOnly: boolean;
}) {
  const updateCursorSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update Cursor account usage",
  });
  const updateClaudeSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update Claude voice input",
  });
  const claudeKeychainUsageEnabled = useEnvironmentSettings(
    environmentId,
    (settings) => settings.claudeKeychainUsageEnabled,
  );
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const platform = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.environment
    .platform;
  const [updatingCursor, setUpdatingCursor] = useState(false);
  const [updatingClaude, setUpdatingClaude] = useState(false);

  if (platform?.os !== "darwin") return null;

  const setCursorUsageEnabled = async (enabled: boolean) => {
    setUpdatingCursor(true);
    const result = await updateCursorSettings({
      environmentId,
      input: { patch: { cursorKeychainUsageEnabled: enabled } },
    });
    if (result._tag === "Success") {
      await refreshProviders({ environmentId, input: {} });
    }
    setUpdatingCursor(false);
  };

  const setClaudeVoiceEnabled = async (enabled: boolean) => {
    setUpdatingClaude(true);
    await updateClaudeSettings({
      environmentId,
      input: { patch: { claudeKeychainUsageEnabled: enabled } },
    });
    setUpdatingClaude(false);
  };

  return (
    <SettingsSection {...searchableSetting("usage-providers")}>
      <SettingsRow
        id="cursor-keychain-usage"
        title="Cursor account usage"
        description="Reads your Cursor CLI login from macOS Keychain. macOS may ask for access."
        control={
          <Switch
            aria-label="Cursor account usage"
            checked={cursorKeychainUsageEnabled}
            disabled={readOnly || updatingCursor}
            onCheckedChange={(enabled) => void setCursorUsageEnabled(enabled)}
          />
        }
      />
      <SettingsRow
        id="claude-keychain-voice"
        title="Claude voice input"
        description="Let Supaterm read your Claude login from the macOS Keychain for voice input. macOS may ask for access."
        control={
          <Switch
            aria-label="Claude voice input"
            checked={claudeKeychainUsageEnabled}
            disabled={readOnly || updatingClaude}
            onCheckedChange={(enabled) => void setClaudeVoiceEnabled(enabled)}
          />
        }
      />
    </SettingsSection>
  );
}
