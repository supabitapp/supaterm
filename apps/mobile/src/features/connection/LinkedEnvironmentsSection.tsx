import { useAtomValue } from "@effect/atom-react";
import {
  ANOTHER_ADDRESS,
  offersLinkedEnvironments,
  peerLinkCreateInput,
  peerLinkTarget,
} from "@supaterm/client-runtime/link-request";
import { peerLinkHealth } from "@supaterm/client-runtime/state/peerLinks";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { useFocusEffect } from "@react-navigation/native";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type AuthMcpClientAccess,
  AuthSettingsWriteScope,
  type EnvironmentId,
  type PeerLinkSummary,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { useCallback, useRef, useState } from "react";
import { AppState, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { Sheet } from "../../components/ui/Sheet";
import { useEnvironments } from "../../state/environments";
import { peerLinkEnvironment, useLinkableMachines } from "../../state/peerLinks";
import { mintPairingCodeOn } from "../../state/peerPairingCode";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope, usePreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import type { SettingsTarget } from "../settings/settings-environment-filter";
import {
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
  uniformMobileSetting,
} from "../settings/settings-scoped-server";
import { useSettingsWriter } from "../settings/useSettingsWriter";
import { LinkAccessPicker, linkAccessLabel } from "./LinkAccessPicker";
import { LinkAddressWarning, LinkMachineSelect } from "./LinkMachineSelect";
import { linkCapableEnvironments, linkFailureMessage, linkHealthText } from "./linkedEnvironments";

export function LinkedEnvironmentsSection() {
  const { environments } = useEnvironments();
  const hosts = linkCapableEnvironments(environments);
  if (hosts.length === 0) return null;
  return (
    <View className="mt-5 gap-3">
      <View className="gap-5">
        {hosts.map((environment) => (
          <MachineLinks key={environment.environmentId} environment={environment} />
        ))}
      </View>
      <Text className="px-2 text-sm text-foreground-muted">
        Let agents on a machine work on your other machines, and theirs on it. Turn it on for each
        machine. While off, nothing new starts over a link; running tasks finish.
      </Text>
    </View>
  );
}

function MachineLinks(props: { readonly environment: SettingsTarget }) {
  const { environment } = props;
  const { environmentId } = environment;
  const targets = resolveMobileSettingsTargets([environment], null);
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const writeSettings = useSettingsWriter();
  const [saving, setSaving] = useState(false);
  const offered = offersLinkedEnvironments(environment.serverConfig);
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const listed = offered && canRead;
  const links = useEnvironmentQuery(
    listed ? peerLinkEnvironment.list({ environmentId, input: {} }) : null,
  );
  const canLink = useAtomValue(peerLinkEnvironment.link.permissionAtom(environmentId));
  const [linking, setLinking] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now);
  const hasLinks = listed && (links.data?.links.length ?? 0) > 0;
  useFocusEffect(
    useCallback(() => {
      if (!hasLinks) return;
      const updateNow = () => setNowMs(Date.now());
      updateNow();
      const timer = setInterval(updateNow, 60_000);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") updateNow();
      });
      return () => {
        clearInterval(timer);
        subscription.remove();
      };
    }, [hasLinks]),
  );
  const now = DateTime.makeUnsafe(nowMs);
  return (
    <View>
      <SettingsSection title={`Linked from ${environment.label}`}>
        <SettingsSwitchRow
          icon="link"
          label="Linked environments"
          value={uniformMobileSetting(targets, "linkedEnvironmentsEnabled")}
          disabled={!canWriteSettings || saving}
          onValueChange={(value) => {
            setSaving(true);
            void writeSettings(
              targets,
              planMobileScopedSettingsPatch(targets, false, { linkedEnvironmentsEnabled: value }),
            ).finally(() => setSaving(false));
          }}
        />
        {listed ? (
          <LinkedEnvironmentRows
            environmentId={environmentId}
            links={links.data?.links}
            error={links.error}
            now={now}
          />
        ) : null}
        {offered && canLink ? (
          <View className="border-t border-border-subtle">
            <ListActionRow icon="plus" label="Link" onPress={() => setLinking(true)} />
          </View>
        ) : null}
      </SettingsSection>
      {linking ? (
        <LinkEnvironmentSheet environmentId={environmentId} onClose={() => setLinking(false)} />
      ) : null}
    </View>
  );
}

function LinkedEnvironmentRows(props: {
  readonly environmentId: EnvironmentId;
  readonly links: ReadonlyArray<PeerLinkSummary> | undefined;
  readonly error: string | null;
  readonly now: DateTime.Utc;
}) {
  if (props.error) {
    return (
      <View className="border-t border-border-subtle">
        <ListRowLayout label="Could not load linked environments" description={props.error} />
      </View>
    );
  }
  if (props.links === undefined) {
    return (
      <View className="border-t border-border-subtle">
        <ListRowLayout label="Loading linked environments…" />
      </View>
    );
  }
  if (props.links.length === 0) {
    return (
      <View className="border-t border-border-subtle">
        <ListRowLayout
          label="No linked environments"
          description="Link another machine running Supaterm, such as a VPS, so agents here can launch and drive threads there."
        />
      </View>
    );
  }
  return props.links.map((link) => (
    <LinkedEnvironmentRow
      key={link.environmentId}
      environmentId={props.environmentId}
      link={link}
      now={props.now}
    />
  ));
}

function LinkedEnvironmentRow(props: {
  readonly environmentId: EnvironmentId;
  readonly link: PeerLinkSummary;
  readonly now: DateTime.Utc;
}) {
  const { link } = props;
  const health = peerLinkHealth(link, props.now);
  const unlink = useAtomCommand(peerLinkEnvironment.unlink, { label: "unlink environment" });
  const canUnlink = useAtomValue(peerLinkEnvironment.unlink.permissionAtom(props.environmentId));
  const [busy, setBusy] = useState(false);
  // Matches ListRowLayout: large text moves the action below the status instead of squeezing the name.
  const stacked = useWindowDimensions().fontScale >= 1.5;
  const status = linkHealthText(health);
  const forget = () =>
    Dialog.confirm({
      title: `Forget ${link.label}?`,
      message: `Agents here stop working there. Revoke "Supaterm · …" in ${link.label}'s Sharing & access to end the session there too.`,
      confirmText: "Forget",
      destructive: true,
      onConfirm: () => {
        setBusy(true);
        void unlink({
          environmentId: props.environmentId,
          input: { environmentId: link.environmentId },
        }).then((result) => {
          setBusy(false);
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            Dialog.alert(
              "Could not forget the link",
              error instanceof Error ? error.message : String(error),
            );
          }
        });
      },
    });
  const action = canUnlink ? (
    <Button
      label={busy ? "Forgetting…" : "Forget"}
      accessibilityLabel={`Forget ${link.label}`}
      tone="danger"
      loading={busy}
      onPress={forget}
    />
  ) : null;
  return (
    <View className="gap-2 border-t border-border-subtle p-4">
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base font-supaterm-bold text-foreground">{link.label}</Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={2}>
            {linkAccessLabel(link.access)} ·{" "}
            <Text
              className={
                health.kind === "reachable" && health.expiresInDays === null
                  ? "text-foreground-muted"
                  : "text-danger-foreground"
              }
            >
              {status}
            </Text>
          </Text>
        </View>
        {stacked ? null : action}
      </View>
      {stacked && action ? <View className="items-start">{action}</View> : null}
    </View>
  );
}

function LinkEnvironmentSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const machines = useLinkableMachines(props.environmentId, true);
  const [choice, setChoice] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [access, setAccess] = useState<AuthMcpClientAccess>("approval-required");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintFailed, setMintFailed] = useState<ReadonlySet<EnvironmentId>>(new Set());
  // Submit then a tap can both run before a re-render; this guard is synchronous.
  const inFlight = useRef(false);
  const link = useAtomCommand(peerLinkEnvironment.link, {
    label: "link environment",
    // The failure cause holds the request, and with it the code; keep it out of the console.
    reportFailure: false,
    reportDefect: false,
  });
  const target = peerLinkTarget(machines, choice);
  const machine = target.kind === "none" ? null : target.machine;
  const mintable = target.kind === "machine" ? target.machine.environmentId : null;
  const connected = usePreparedConnection(mintable);
  const mayMint = useEnvironmentScope(mintable, AuthAccessWriteScope);
  // This phone mints a code there when it is connected with a session that may
  // create pairing links, and only for its own addresses: anything can answer
  // as that machine at one typed in, so that one gets a code the user fetched.
  const mintOn =
    mintable !== null && Option.isSome(connected) && mayMint && !mintFailed.has(mintable)
      ? mintable
      : null;
  const ready =
    mintOn !== null || peerLinkCreateInput({ target, address, access, pairingCode }) !== null;

  // Settles to the code to link with, or null after reporting why there is none.
  const resolvePairingCode = async () => {
    if (mintOn === null) return pairingCode;
    const minted = await mintPairingCodeOn(mintOn, access);
    if (Result.isSuccess(minted)) return minted.success;
    setMintFailed((failed) => new Set(failed).add(mintOn));
    setError(linkFailureMessage(minted.failure));
    return null;
  };

  const submit = async () => {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const code = await resolvePairingCode();
    const input =
      code === null ? null : peerLinkCreateInput({ target, address, access, pairingCode: code });
    const result =
      input === null ? null : await link({ environmentId: props.environmentId, input });
    inFlight.current = false;
    setBusy(false);
    if (result === null) return;
    if (result._tag === "Success") props.onClose();
    else if (!isAtomCommandInterrupted(result)) {
      pipe(squashAtomCommandFailure(result), linkFailureMessage, setError);
    }
  };

  return (
    <Sheet
      title="Link an environment"
      onClose={props.onClose}
      // A link that lands after a close would still be made, and would close a reopened sheet.
      dismissDisabled={busy}
    >
      <ScrollView
        className="flex-1 bg-sheet-solid"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text className="font-sans text-sm leading-5 text-foreground-muted">
          Agents here can then launch, message and wait on threads there. It appears in that
          environment's Sharing & access, where it can be revoked.
        </Text>
        {machines.length > 0 ? (
          <LinkMachineSelect
            machines={machines}
            value={choice}
            disabled={busy}
            onChange={(value) => {
              setChoice(value);
              setError(null);
            }}
          />
        ) : null}
        {machine?.linked ? (
          <Text className="font-sans text-xs text-foreground-muted">
            Already linked. Linking again renews it with the access you pick.
          </Text>
        ) : null}
        {target.kind === "address" ? (
          <View className="gap-2">
            <TextInput
              accessibilityLabel="Address"
              placeholder="https://machine.tailnet.ts.net"
              value={address}
              onChangeText={(value) => {
                setAddress(value);
                // Machines found after typing began must not hide the address being typed.
                if (choice === null) setChoice(ANOTHER_ADDRESS);
              }}
              editable={!busy}
              autoCorrect={false}
              autoCapitalize="none"
              keyboardType="url"
              spellCheck={false}
            />
            {machine !== null ? (
              <Text className="font-sans text-xs text-foreground-muted">
                This app has no address for {machine.label} that another machine can reach. Enter
                its https or Tailscale address.
              </Text>
            ) : null}
          </View>
        ) : null}
        {target.kind === "address" && address.trim() ? (
          <LinkAddressWarning address={address} />
        ) : null}
        {target.kind === "none" || mintOn !== null ? null : (
          <View className="gap-2">
            <TextInput
              accessibilityLabel="Pairing code"
              placeholder={
                machine === null
                  ? "From that environment's Sharing & access, or supaterm pair there"
                  : "Paste the code"
              }
              value={pairingCode}
              onChangeText={setPairingCode}
              editable={!busy}
              autoCorrect={false}
              autoCapitalize="none"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              spellCheck={false}
            />
            {machine !== null ? (
              <Text className="font-sans text-xs text-foreground-muted">
                Create a link on {machine.label}: Settings → Sharing & access → Add device, then
                paste its code here.
              </Text>
            ) : null}
          </View>
        )}
        <LinkAccessPicker value={access} disabled={busy} onChange={setAccess} />
        {error !== null ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            className="font-sans text-sm text-danger-foreground"
          >
            {error}
          </Text>
        ) : null}
        <Button
          label={busy ? "Linking…" : "Link"}
          disabled={busy || !ready}
          onPress={() => void submit()}
          tone="primary"
          fullWidth
        />
        <Button label="Cancel" tone="secondary" disabled={busy} onPress={props.onClose} fullWidth />
      </ScrollView>
    </Sheet>
  );
}
