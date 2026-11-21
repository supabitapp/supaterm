import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useFocusEffect } from "@react-navigation/native";
import { linkLabels, offersLinkedEnvironments } from "@supaterm/client-runtime/link-request";
import {
  incomingLinkNames,
  peerLinkHealth,
  type PeerLinkHealth,
} from "@supaterm/client-runtime/state/peerLinks";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  AuthAccessReadScope,
  AuthSettingsWriteScope,
  type EnvironmentId,
  type PeerLinkSummary,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useContext, useMemo, useState } from "react";
import { AppState, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { useNowMinuteMs } from "../../lib/clock";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { peerLinkEnvironment } from "../../state/peerLinks";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { linkAccessLabel } from "../threads/thread-settings-options";

const alertFailure = (title: string, result: AtomCommandResult<unknown, unknown>) => {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const failure = squashAtomCommandFailure(result);
  Dialog.alert(title, failure instanceof Error ? failure.message : String(failure));
};

export function LinkedEnvironmentsSections() {
  const { environments } = useEnvironments();
  const hosts = useMemo(
    () =>
      environments.filter(
        (environment) =>
          environment.connection.phase === "connected" &&
          environment.serverConfig?.environment.capabilities.peerLinks === true,
      ),
    [environments],
  );
  const incoming = useIncomingLinkNames(hosts);
  if (hosts.length === 0) return null;
  return (
    <View className="mt-5 gap-3">
      <SettingsSection
        title="Linked environments"
        footer="Agents on a machine can work on the machines it links to. Each link goes one way: turn this on for both machines, then mention the other machine with @ in a thread on the one that sends the work, and answer the agent's request. While off, nothing new starts over a link; running tasks finish."
      >
        {hosts.map((environment, index) => (
          <View
            key={environment.environmentId}
            className={index === 0 ? undefined : "border-t border-border-subtle"}
          >
            <LinkedEnvironmentHost
              environmentId={environment.environmentId}
              environmentLabel={hosts.length > 1 ? environment.label : null}
              incoming={incoming.get(environment.environmentId) ?? []}
            />
          </View>
        ))}
      </SettingsSection>
    </View>
  );
}

/** Reads each enabled, readable host's links once, for every host row to share. */
function useIncomingLinkNames(
  hosts: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly serverConfig?: Parameters<typeof offersLinkedEnvironments>[0];
  }>,
) {
  const sources = useMemo(
    () => hosts.filter((host) => offersLinkedEnvironments(host.serverConfig)),
    [hosts],
  );
  const readable = useEnvironmentsWithScope(sources, AuthAccessReadScope);
  const permitted = sources.filter((source) => readable.has(source.environmentId));
  const results = useAtomValue(
    peerLinkEnvironment.lists(permitted.map((source) => source.environmentId)),
  );
  const nowMs = useNowMinuteMs();
  return incomingLinkNames({
    sources: permitted.flatMap((source, index) => {
      const result = results[index];
      return result !== undefined && AsyncResult.isSuccess(result)
        ? [{ label: source.label, links: result.value.links }]
        : [];
    }),
    now: DateTime.makeUnsafe(nowMs),
  });
}

export function LinkedEnvironmentHost(props: {
  readonly environmentId: EnvironmentId;
  /** Names the environment when the screen lists more than one. */
  readonly environmentLabel: string | null;
  /** The other connected machines whose links reach this one. */
  readonly incoming?: ReadonlyArray<string>;
}) {
  const { environmentId } = props;
  const enabled = offersLinkedEnvironments(useEnvironmentServerConfig(environmentId));
  const canConfigure = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const canList = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "linked environments update",
  });
  const setEnabled = async (value: boolean) => {
    const result = await updateSettings({
      environmentId,
      input: { patch: { linkedEnvironmentsEnabled: value } },
    });
    alertFailure("Could not save settings", result);
  };
  return (
    <>
      <SettingsSwitchRow
        icon="link"
        label={props.environmentLabel ?? "Let agents work on your other machines"}
        {...(props.incoming && props.incoming.length > 0
          ? { subtitle: `Linked from ${props.incoming.join(", ")}.` }
          : {})}
        value={enabled}
        disabled={!canConfigure}
        onValueChange={(value) => void setEnabled(value)}
      />
      {enabled && canList ? <LinkedEnvironmentsList environmentId={environmentId} /> : null}
    </>
  );
}

function LinkedEnvironmentsList({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const listAtom = peerLinkEnvironment.list({ environmentId, input: {} });
  const links = useEnvironmentQuery(listAtom);
  const { environments } = useEnvironments();
  const registry = useContext(RegistryContext);
  // Links change outside this client, and the shared list only revalidates when built, so
  // showing the screen and bringing the app back ask again.
  useFocusEffect(
    useCallback(() => {
      const askAgain = () => {
        if (!registry.get(listAtom).waiting) registry.refresh(listAtom);
      };
      askAgain();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") askAgain();
      });
      return () => subscription.remove();
    }, [listAtom, registry]),
  );
  const now = DateTime.makeUnsafe(useNowMinuteMs());
  if (links.error)
    return <ListNote title="Could not load linked environments" body={links.error} />;
  if (!links.data) return <ListNote title="Loading linked environments…" />;
  if (links.data.links.length === 0) return null;
  const labels = linkLabels({ links: links.data.links, environments });
  return links.data.links.map((link) => (
    <LinkedEnvironmentRow
      key={link.environmentId}
      environmentId={environmentId}
      link={link}
      label={labels.get(link.environmentId) ?? link.label}
      health={peerLinkHealth(link, now)}
    />
  ));
}

function ListNote(props: { readonly title: string; readonly body?: string }) {
  return (
    <View className="gap-0.5 border-t border-border-subtle p-4">
      <Text className="text-sm text-foreground-muted">{props.title}</Text>
      {props.body ? (
        <Text selectable className="text-xs text-danger-foreground">
          {props.body}
        </Text>
      ) : null}
    </View>
  );
}

const healthText = (health: PeerLinkHealth) => {
  switch (health.kind) {
    case "expired":
      return "Expired. Link it again with a new pairing code.";
    case "unreachable":
      return health.detail ?? "Not answering right now.";
    case "failing":
      return health.detail;
    case "reachable":
      return health.expiresInDays === null
        ? "Reachable"
        : `Expires in ${health.expiresInDays} ${health.expiresInDays === 1 ? "day" : "days"}. Link it again to renew.`;
  }
};

function LinkedEnvironmentRow(props: {
  readonly environmentId: EnvironmentId;
  readonly link: PeerLinkSummary;
  readonly health: PeerLinkHealth;
  /** What this client calls the linked environment. */
  readonly label: string;
}) {
  const { environmentId, link, health, label } = props;
  const unlink = useAtomCommand(peerLinkEnvironment.unlink, { label: "unlink environment" });
  const canUnlink = useAtomValue(peerLinkEnvironment.unlink.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const forget = async () => {
    setBusy(true);
    const result = await unlink({ environmentId, input: { environmentId: link.environmentId } });
    setBusy(false);
    alertFailure("Could not forget the link", result);
  };
  return (
    <View className="flex-row items-center gap-3 border-t border-border-subtle py-4 pr-4 pl-12">
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base font-supaterm-bold text-foreground" numberOfLines={1}>
          {label}
        </Text>
        <Text className="text-xs text-foreground-muted">
          Agents here work there · {linkAccessLabel(link.access)}
        </Text>
        <Text
          className={
            health.kind === "reachable" && health.expiresInDays === null
              ? "text-xs text-foreground-muted"
              : "text-xs text-danger-foreground"
          }
          numberOfLines={2}
        >
          {healthText(health)}
        </Text>
      </View>
      {canUnlink ? (
        <Button
          label="Forget"
          accessibilityLabel={`Forget ${label}`}
          tone="danger"
          size="compact"
          loading={busy}
          onPress={() =>
            Dialog.confirm({
              title: `Forget ${label}?`,
              message: `Agents here stop working there. Revoke "Supaterm · …" in ${label}'s Sharing & access to end the session there too.`,
              confirmText: "Forget",
              destructive: true,
              onConfirm: () => void forget(),
            })
          }
        />
      ) : null}
    </View>
  );
}
