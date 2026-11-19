import type {
  EnvironmentId,
  RelayHostStatus,
  ServerSettings,
  ServerSettingsPatch,
} from "@supaterm/contracts";
import { relayName } from "@supaterm/shared/relay/name";

import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

function statusDescription(status: RelayHostStatus): string | null {
  const name = status.relayEndpoint === undefined ? null : relayName(status.relayEndpoint);
  switch (status.state) {
    case "off":
      return null;
    case "idle":
      return "Ready to link a device. Use Add device below to create a pairing link.";
    case "connecting":
      return "Preparing your connection…";
    case "registered":
      return name === null
        ? "Connected. Paired clients can reach this host from anywhere."
        : `Connected as ${name}. Paired clients can reach this host from anywhere.`;
    case "superseded":
      return "Another host is using this relay identity. Turn Encrypted Relay off and on to reconnect here.";
    case "invalid-url":
      return "The relay server URL is invalid.";
  }
}

export function usePublicRelayStatus(environmentId: EnvironmentId | null): RelayHostStatus | null {
  return (
    useEnvironmentQuery(
      environmentId === null ? null : serverEnvironment.relayStatus({ environmentId, input: {} }),
    ).data ?? null
  );
}

export function PublicRelaySettings({
  status,
  settings,
  disabled,
  update,
}: {
  readonly status: RelayHostStatus | null;
  readonly settings: Pick<ServerSettings, "publicRelayEnabled"> | undefined;
  readonly disabled: boolean;
  readonly update: (patch: ServerSettingsPatch) => void;
}) {
  const enabled = settings?.publicRelayEnabled ?? false;
  return (
    <SettingsRow
      title={searchableSetting("public-relay").title}
      description={
        (enabled && status ? statusDescription(status) : null) ??
        "Connect your other devices from anywhere with end-to-end encryption. Turn it on, then use Add device below."
      }
      control={
        <Switch
          aria-label="Enable Encrypted Relay"
          disabled={disabled}
          checked={enabled}
          onCheckedChange={(publicRelayEnabled) => update({ publicRelayEnabled })}
        />
      }
    />
  );
}
