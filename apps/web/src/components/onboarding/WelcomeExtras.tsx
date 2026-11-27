import { AuthSettingsWriteScope, type EnvironmentId } from "@supaterm/contracts";
import { CheckIcon, SmartphoneIcon, UsersIcon } from "@supaterm/icons";
import { T, useGT } from "gt-react";
import { useState, type ReactNode } from "react";

import { deviceEnvironment, useDeviceState } from "../../state/device";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationSkills } from "../../state/useOrchestrationSkills";
import { DeviceHubSetupStatus, deviceHubReadiness } from "../device/DeviceSetup";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { RowIcon, WelcomeSection } from "./WelcomeSection";

/** Opt-in features worth turning on at first run. Settings turns either back off. */
export function WelcomeExtras({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const gt = useGT();
  const skills = useOrchestrationSkills([{ environmentId, label }], serverEnvironment);
  const devices = useWelcomeDevices(environmentId);
  const showSkills = skills.pending !== null || skills.installed || skills.canInstall;
  if (!showSkills && devices === null) return null;
  return (
    <WelcomeSection title={gt("Extras")}>
      {showSkills ? (
        <ExtraRow
          icon={<UsersIcon className="size-4" />}
          title={gt("Committee and advisor")}
          detail={gt(
            "Skills that let your agents ask other agents for a second opinion or a plan.",
          )}
          control={
            skills.installed && skills.pending === null ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-foreground">
                <CheckIcon className="size-3.5" />
                <T>Installed</T>
              </span>
            ) : skills.pending === "Status" ? (
              <span className="text-xs text-muted-foreground">
                <T>Checking…</T>
              </span>
            ) : (
              <Button
                size="xs"
                variant="outline"
                disabled={skills.pending !== null}
                onClick={() => void skills.request("Install")}
              >
                {skills.pending === "Install" ? gt("Installing…") : gt("Install")}
              </Button>
            )
          }
        />
      ) : null}
      {devices ? (
        <ExtraRow
          icon={<SmartphoneIcon className="size-4" />}
          title={gt("Simulators")}
          detail={
            devices.platforms === "both"
              ? gt("Open iOS simulators and Android emulators here and let agents control them.")
              : devices.platforms === "ios"
                ? gt("Open iOS simulators here and let agents control them.")
                : gt("Open Android emulators here and let agents control them.")
          }
          control={
            <span className="flex items-center gap-3">
              <DeviceHubSetupStatus state={devices.state} pending={devices.busy} compact />
              <Switch
                checked={devices.enabled}
                disabled={devices.busy}
                aria-label={gt("Simulators")}
                onCheckedChange={(checked) => void devices.setEnabled(Boolean(checked))}
              />
            </span>
          }
        />
      ) : null}
    </WelcomeSection>
  );
}

/** The device row appears only where this computer can run a simulator or an emulator. */
function useWelcomeDevices(environmentId: EnvironmentId) {
  const { state, loaded } = useDeviceState(environmentId);
  const canConfigure = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const configure = useAtomCommand(deviceEnvironment.configure);
  const [saving, setSaving] = useState(false);
  const local = state.hosts.find((host) => host.kind === "local");
  const ios = local?.platforms.some((p) => p.platform === "ios" && p.available) ?? false;
  const android = local?.platforms.some((p) => p.platform === "android" && p.available) ?? false;
  if (!loaded || !canConfigure || (!ios && !android)) return null;
  const setEnabled = async (enabled: boolean) => {
    if (!readEnvironmentScope(environmentId, AuthSettingsWriteScope)) return;
    setSaving(true);
    await configure({
      environmentId,
      input: enabled
        ? { enabled, onboardingCompleted: true }
        : { enabled, agentAccessEnabled: false },
    });
    setSaving(false);
  };
  return {
    state,
    platforms: ios && android ? "both" : ios ? "ios" : "android",
    enabled: state.hostStatus !== "disabled",
    busy: saving || deviceHubReadiness(state).busy,
    setEnabled,
  } as const;
}

function ExtraRow({
  icon,
  title,
  detail,
  control,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail: string;
  readonly control: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center gap-3 py-1">
      <RowIcon>{icon}</RowIcon>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
