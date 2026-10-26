import { BranchNamingSettings } from "./BranchNamingSettings";
import { StartFromRemoteRow, WorktreeSubmodulesRow } from "./ProjectDefaultsSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { WorktreeCleanupSection, WorktreesDirectoryRow } from "./StorageSettings";

export function WorktreesSettingsPanel() {
  const { scope } = useSettingsScope();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";

  return (
    <SettingsPageContainer>
      <SettingsSection id="worktree-creation" title="Creation">
        {!isProjectScope && <WorktreesDirectoryRow />}
        <StartFromRemoteRow />
        <WorktreeSubmodulesRow />
      </SettingsSection>
      <SettingsSection id="worktree-branches" title="Branches">
        <BranchNamingSettings />
      </SettingsSection>
      <WorktreeCleanupSection />
    </SettingsPageContainer>
  );
}
