import { useAtomValue } from "@effect/atom-react";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type EnvironmentId,
  type TailnetSettingsPatch,
} from "@supaterm/contracts";
import { managedSettingDenial } from "@supaterm/client-runtime/managed-policy";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type * as Cause from "effect/Cause";
import { tailnetAdmissionDescription, tailnetView } from "@supaterm/client-runtime/tailnet/view";
import { useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { ListToggleRow as SettingsToggleRow } from "../../components/ui/ListToggleRow";
import { useNowMinuteMs } from "../../lib/clock";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { tailnetEnvironment } from "../../state/tailnet";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";

type Pending = "settings" | "sign-in" | "sign-out" | null;

function failureMessage(result: { readonly cause: Cause.Cause<unknown> }, fallback: string) {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

export function BuiltInTailscaleSection({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  const canSignIn = useAtomValue(tailnetEnvironment.login.permissionAtom(environmentId));
  const canSignOut = useAtomValue(tailnetEnvironment.logout.permissionAtom(environmentId));
  const settings = config?.settings.tailnet ?? null;
  const status = useEnvironmentQuery(
    canRead && settings !== null ? tailnetEnvironment.status({ environmentId, input: {} }) : null,
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const login = useAtomCommand(tailnetEnvironment.login, { reportFailure: false });
  const logout = useAtomCommand(tailnetEnvironment.logout, { reportFailure: false });
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitingForBrowser, setWaitingForBrowser] = useState(false);
  const now = useNowMinuteMs();
  const gt = useGT();
  const m = useMessages();
  if (config === null || settings === null || !canRead) return null;
  const view = tailnetView({
    status: status.data,
    settings,
    machineHostname: config.hostname ?? "",
    now,
    managedPolicy: config.managedPolicy,
    resolve: m,
  });
  const locked = (path: string) => managedSettingDenial([config.managedPolicy], [path], m);
  const withReason = (subtitle: string, reason: string | undefined) =>
    reason === undefined ? subtitle : gt("{subtitle} {reason}", { subtitle, reason });
  const enabledLock = locked("tailnet.enabled");
  const admissionLock = locked("tailnet.admission");
  if (view.kind !== "needs-login" && waitingForBrowser) setWaitingForBrowser(false);

  const patch = async (tailnet: TailnetSettingsPatch) => {
    if (pending !== null || !readEnvironmentScope(environmentId, AuthAccessWriteScope)) return;
    setPending("settings");
    setError(null);
    const result = await updateSettings({ environmentId, input: { patch: { tailnet } } });
    setPending(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      setError(failureMessage(result, gt("Could not save the Tailscale setting.")));
    }
  };

  const signIn = async () => {
    if (pending !== null || !readEnvironmentScope(environmentId, AuthAccessWriteScope)) return;
    setPending("sign-in");
    setError(null);
    const result = await login({ environmentId, input: {} });
    setPending(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        setError(failureMessage(result, gt("Could not start Tailscale sign-in.")));
      }
      return;
    }
    const opened = await tryOpenExternalUrl(result.value.loginUrl, "provider-auth");
    setWaitingForBrowser(opened);
    if (!opened) setError(gt("Could not open the Tailscale sign-in page."));
  };

  const signOut = () =>
    Dialog.alert(
      gt("Sign out of Tailscale?"),
      gt(
        "This machine leaves your tailnet. Devices using its Tailscale address lose access until you sign in again.",
      ),
      [
        { text: gt("Cancel"), style: "cancel" },
        {
          text: gt("Sign out", { $context: "verb, signs this machine out of Tailscale" }),
          style: "destructive",
          onPress: () =>
            void (async () => {
              if (pending !== null || !readEnvironmentScope(environmentId, AuthAccessWriteScope))
                return;
              setPending("sign-out");
              setError(null);
              const result = await logout({ environmentId, input: {} });
              setPending(null);
              if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                setError(failureMessage(result, gt("Could not sign out of Tailscale.")));
              }
            })(),
        },
      ],
    );

  const busy = pending !== null;
  const ownerLogin = view.kind === "running" ? view.ownerLogin : null;
  const accountNotes = [
    ...(view.account?.warnings ?? []),
    ...(view.kind === "needs-login" && waitingForBrowser
      ? [gt("Finish signing in in your browser. This updates on its own.")]
      : []),
  ];
  return (
    <SettingsSection title={gt("Built-in Tailscale")}>
      <SettingsToggleRow
        label={gt("Serve over Tailscale")}
        description={withReason(view.summary, enabledLock)}
        value={settings.enabled}
        disabled={
          busy ||
          !canWrite ||
          view.serveManaged !== undefined ||
          (view.kind === "unavailable" && !settings.enabled)
        }
        onValueChange={(enabled) => void patch({ enabled })}
      />
      {view.account !== null ? (
        <View className="gap-1 px-4 py-3">
          <Text className="text-base text-foreground">{view.account.title}</Text>
          {view.account.detail !== null ? (
            <Text selectable className="text-sm text-foreground-muted">
              {view.account.detail}
            </Text>
          ) : null}
          {accountNotes.map((note) => (
            <Text key={note} className="text-sm text-warning-foreground">
              {note}
            </Text>
          ))}
        </View>
      ) : null}
      {view.kind === "running" ? (
        <View className="gap-1 px-4 py-3">
          <Text className="text-base text-foreground">
            {gt("Address", { $context: "network address of this machine" })}
          </Text>
          <Text selectable className="text-sm text-foreground-muted">
            {view.address ?? view.dnsName}
          </Text>
          {view.addressNote !== null ? (
            <Text className="text-sm text-warning-foreground">{view.addressNote}</Text>
          ) : null}
        </View>
      ) : null}
      {status.data === null && status.error ? (
        <Text selectable className="px-4 py-2 text-sm text-danger-foreground">
          {status.error}
        </Text>
      ) : null}
      {error ? (
        <Text selectable className="px-4 py-2 text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}
      {view.account?.action === "sign-in" && canSignIn ? (
        <SettingsActionRow
          icon="person.crop.circle"
          label={waitingForBrowser ? gt("Open sign-in page again") : gt("Sign in…")}
          disabled={busy}
          loading={pending === "sign-in"}
          onPress={() => void signIn()}
        />
      ) : null}
      {view.account?.action === "sign-out" && canSignOut ? (
        <SettingsActionRow
          icon="person.fill.xmark"
          label={gt("Sign out…")}
          tone="danger"
          disabled={busy}
          loading={pending === "sign-out"}
          onPress={signOut}
        />
      ) : null}
      {view.kind !== "unavailable" ? (
        <SettingsToggleRow
          label={gt("Limit access to your Tailscale account")}
          description={withReason(
            tailnetAdmissionDescription(settings.admission, ownerLogin, m),
            admissionLock,
          )}
          value={settings.admission === "owner"}
          disabled={busy || !canWrite || admissionLock !== undefined}
          onValueChange={(owner) => void patch({ admission: owner ? "owner" : "tailnet" })}
        />
      ) : null}
    </SettingsSection>
  );
}
