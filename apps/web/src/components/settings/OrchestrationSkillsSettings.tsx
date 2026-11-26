import type { OrchestrationSkillsEnvironment } from "@supaterm/client-runtime/orchestrationSkills";
import { useOrchestrationSkills } from "../../state/useOrchestrationSkills";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { T, useGT } from "gt-react";

function SelectedEnvironmentSkills({
  environments,
}: {
  environments: readonly OrchestrationSkillsEnvironment[];
}) {
  const gt = useGT();
  const skills = useOrchestrationSkills(environments, serverEnvironment);
  const busy = skills.pending !== null;
  const stateLabel =
    skills.pending === "Status"
      ? gt("Checking…")
      : skills.pending === null && skills.installed
        ? gt("Installed")
        : null;
  const hasControl =
    stateLabel !== null || skills.canUninstall || skills.canInstall || skills.error;
  return (
    <SettingsRow
      title={gt("Orchestration skills")}
      description={
        <>
          <T>Install supaterm-commitee and supaterm-advisor skills.</T>
          {skills.notices.map((notice) => (
            <span className="block" key={notice}>
              {notice}
            </span>
          ))}
        </>
      }
      control={
        hasControl ? (
          <>
            {stateLabel ? (
              <span className="text-xs text-muted-foreground">{stateLabel}</span>
            ) : null}
            {skills.canUninstall ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void skills.request("Uninstall")}
              >
                {skills.pending === "Uninstall" ? gt("Uninstalling…") : gt("Uninstall")}
              </Button>
            ) : null}
            {skills.canInstall ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void skills.request("Install")}
              >
                {skills.pending === "Install" ? gt("Installing…") : gt("Install")}
              </Button>
            ) : null}
            {skills.error ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void skills.request("Status")}
              >
                <T>Retry</T>
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}

export function OrchestrationSkillsSettings() {
  const gt = useGT();
  const { environments, connectedEnvironments } = useSettingsScope();
  const offline = environments.filter(
    (environment) =>
      !connectedEnvironments.some(
        (connected) => connected.environmentId === environment.environmentId,
      ),
  );
  return (
    <SettingsSection {...searchableSetting("orchestration-skills")} hideTitle>
      {connectedEnvironments.length === 0 ? (
        <SettingsRow
          title={gt("Orchestration skills")}
          description={gt(
            "Connect to an environment to install supaterm-commitee and supaterm-advisor skills.",
          )}
        />
      ) : (
        <SelectedEnvironmentSkills
          key={connectedEnvironments
            .map((environment) => environment.environmentId)
            .sort()
            .join(",")}
          environments={connectedEnvironments}
        />
      )}
      {offline.length > 0 ? (
        <SettingsRow
          title={gt("Offline environments")}
          description={gt("Skipped: {environments}. Reconnect and install again to include them.", {
            environments: offline.map((environment) => environment.label).join(", "),
          })}
        />
      ) : null}
    </SettingsSection>
  );
}
