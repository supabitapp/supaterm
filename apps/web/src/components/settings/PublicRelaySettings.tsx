import {
  type EnvironmentId,
  type ManagedPolicySummary,
  type RelayHostStatus,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@supaterm/contracts";
import { managedCapabilityDenial } from "@supaterm/client-runtime/contract-labels";
import { relayName } from "@supaterm/shared/relay/name";

import { managedSettingDenial } from "@supaterm/client-runtime/managed-policy";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { msg, useGT, useMessages } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";

function statusDescription(status: RelayHostStatus, resolve: MessageResolver = m): string | null {
  const name = status.relayEndpoint === undefined ? null : relayName(status.relayEndpoint);
  switch (status.state) {
    case "off":
      return null;
    case "idle":
      return resolve(msg("Ready to link a device. Use Add device below to create a pairing link."));
    case "connecting":
      return resolve(msg("Preparing your connection…"));
    case "registered":
      return name === null
        ? resolve(msg("Connected. Paired clients can reach this host from anywhere."))
        : resolve(
            msg("Connected as {name}. Paired clients can reach this host from anywhere.", { name }),
          );
    case "superseded":
      return resolve(
        msg(
          "Another host is using this relay identity. Turn Encrypted Relay off and on to reconnect here.",
        ),
      );
    case "invalid-url":
      return resolve(msg("The relay server URL is invalid."));
  }
}

export function usePublicRelayStatus(environmentId: EnvironmentId | null): RelayHostStatus | null {
  return (
    useEnvironmentQuery(
      environmentId === null ? null : serverEnvironment.relayStatus({ environmentId, input: {} }),
    ).data ?? null
  );
}

/** Whether the relay serves: the setting is on and no policy switches it off. */
export function isPublicRelayActive(
  settings: Pick<ServerSettings, "publicRelayEnabled"> | undefined,
  policy: ManagedPolicySummary | undefined,
): boolean {
  return (
    (settings?.publicRelayEnabled ?? false) &&
    managedCapabilityDenial(policy, "relay") === undefined
  );
}

export function PublicRelaySettings({
  status,
  settings,
  policy,
  disabled,
  update,
}: {
  readonly status: RelayHostStatus | null;
  readonly settings: Pick<ServerSettings, "publicRelayEnabled"> | undefined;
  readonly policy: ManagedPolicySummary | undefined;
  readonly disabled: boolean;
  readonly update: (patch: ServerSettingsPatch) => void;
}) {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const relayDenial = managedCapabilityDenial(policy, "relay", m);
  const enabled = isPublicRelayActive(settings, policy);
  return (
    <SettingsRow
      title={searchableSetting("public-relay").title}
      description={
        relayDenial ??
        (enabled && status ? m(statusDescription(status, m)) : null) ??
        gt(
          "Connect your other devices from anywhere with end-to-end encryption. Turn it on, then use Add device below.",
        )
      }
      managed={relayDenial ?? managedSettingDenial([policy], ["publicRelayEnabled"], m)}
      control={
        <Switch
          aria-label={gt("Enable Encrypted Relay")}
          disabled={disabled}
          checked={enabled}
          onCheckedChange={(publicRelayEnabled) => update({ publicRelayEnabled })}
        />
      }
    />
  );
}
