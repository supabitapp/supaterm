import type { OrchestrationSkillsEnvironment } from "@supaterm/client-runtime/orchestrationSkills";
import { useOrchestrationSkills } from "../../../state/useOrchestrationSkills";
import { serverEnvironment } from "../../../state/server";
import { AppText as Text } from "../../../components/ui/AppText";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { useGT } from "gt-react-native";

export function OrchestrationSkillsSection({
  environments,
}: {
  environments: readonly OrchestrationSkillsEnvironment[];
}) {
  const gt = useGT();
  const skills = useOrchestrationSkills(environments, serverEnvironment);
  const busy = skills.pending !== null;
  return (
    <SettingsSection title={gt("Orchestration skills")}>
      <Text className="p-4 text-sm text-foreground-muted">
        {gt("Install {commitee} and {advisor} skills.", {
          commitee: "supaterm-commitee",
          advisor: "supaterm-advisor",
        })}
      </Text>
      <SettingsRow
        icon="arrow.down.circle"
        label={
          skills.installed
            ? gt("Installed")
            : skills.pending === "Install"
              ? gt("Installing…")
              : gt("Install", { $context: "verb, installs the skills" })
        }
        disabled={busy || !skills.canInstall}
        onPress={() => void skills.request("Install")}
      />
      {skills.canUninstall ? (
        <SettingsRow
          icon="trash"
          label={
            skills.pending === "Uninstall"
              ? gt("Uninstalling…")
              : gt("Uninstall", { $context: "verb, removes the skills" })
          }
          disabled={busy || !skills.canUninstall}
          onPress={() => void skills.request("Uninstall")}
        />
      ) : null}
      {skills.notices.map((notice) => (
        <Text key={notice} className="p-4 text-sm text-foreground-muted">
          {notice}
        </Text>
      ))}
      {skills.error ? (
        <SettingsRow
          icon="arrow.clockwise"
          label={gt("Retry")}
          value={gt("Retry the selected environments.")}
          disabled={busy}
          onPress={() => void skills.request("Status")}
        />
      ) : null}
    </SettingsSection>
  );
}
