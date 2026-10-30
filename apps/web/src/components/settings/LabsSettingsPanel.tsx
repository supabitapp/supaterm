import { Link } from "@tanstack/react-router";

import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function LabsSettingsPanel() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsPageContainer>
      <SettingsSection id="beta" title="Labs">
        <SettingsRow
          {...searchableSetting("boring-sidebar")}
          description="Group active threads into project folders. Pinned threads stay above, with Snoozed and Done below."
          control={
            <Switch
              checked={settings.boringSidebarEnabled === true}
              onCheckedChange={(checked) => updateSettings({ boringSidebarEnabled: checked })}
              aria-label="Project folders"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("boring-sidebar-multiline")}
          description="Show the branch, pull request, and provider below each folder thread."
          control={
            <Switch
              checked={settings.boringSidebarMultilineRows === true}
              onCheckedChange={(checked) => updateSettings({ boringSidebarMultilineRows: checked })}
              aria-label="Two-line folder rows"
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["guestSharingEnabled"]}
          {...searchableSetting("guest-links")}
          description="Share a thread over an encrypted connection. Guests can watch its reasoning and command output and send messages you approve. Turning this off pauses every guest link on the selected environment."
          control={
            <ScopedSwitch
              settingKeys={["guestSharingEnabled"]}
              checked={settings.guestSharingEnabled === true}
              onCheckedChange={(checked) => updateSettings({ guestSharingEnabled: checked })}
              aria-label="Guest links"
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["linkedEnvironmentsEnabled"]}
          {...searchableSetting("linked-environments-beta")}
          description={
            <>
              Let agents work across your linked machines. Enable this on each machine, then link
              them in <Link to="/settings/connections">Connections</Link>. Turning this off blocks
              new remote work; existing tasks can finish or be stopped.
            </>
          }
          control={
            <ScopedSwitch
              settingKeys={["linkedEnvironmentsEnabled"]}
              checked={settings.linkedEnvironmentsEnabled === true}
              onCheckedChange={(checked) => updateSettings({ linkedEnvironmentsEnabled: checked })}
              aria-label="Linked environments"
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["simlockDeviceHostsEnabled"]}
          {...searchableSetting("simlock-hosts")}
          description="Let the Device panel lease simulators and emulators from your configured Simlock pool."
          control={
            <ScopedSwitch
              settingKeys={["simlockDeviceHostsEnabled"]}
              checked={settings.simlockDeviceHostsEnabled === true}
              onCheckedChange={(checked) => updateSettings({ simlockDeviceHostsEnabled: checked })}
              aria-label="Simlock device hosts"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
