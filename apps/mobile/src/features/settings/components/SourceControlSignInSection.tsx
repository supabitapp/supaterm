import type {
  EnvironmentId,
  SourceControlSignInPrompt,
  SourceControlAppSignIn,
} from "@supaterm/contracts";
import {
  readHostCredentialSettings,
  sourceControlClients,
  type SourceControlDefinition,
} from "@supaterm/client-runtime/source-control-clients";
import * as Cause from "effect/Cause";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { Alert, Linking } from "react-native";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { sourceControlEnvironment } from "../../../state/sourceControl";
import { useAtomCommand } from "../../../state/use-atom-command";
import type { SettingsTarget } from "../settings-environment-filter";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

const failureMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
};

const openUrl = (url: string) => void Linking.openURL(url).catch(() => undefined);

export function SourceControlSignInSection(props: {
  readonly environments: readonly SettingsTarget[];
  readonly canWrite: (environmentId: EnvironmentId) => boolean;
}) {
  return (
    <>
      {props.environments.map((environment) => (
        <OfferedAppSignIn
          key={environment.environmentId}
          environment={environment}
          disabled={!props.canWrite(environment.environmentId)}
        />
      ))}
    </>
  );
}

function OfferedAppSignIn(props: {
  readonly environment: SettingsTarget;
  readonly disabled: boolean;
}) {
  const discovery = useEnvironmentQuery(
    sourceControlEnvironment.discovery({
      environmentId: props.environment.environmentId,
      input: {},
    }),
  );
  return (
    <>
      {discovery.data?.sourceControlProviders.flatMap((provider) => {
        const definition = sourceControlClients.find(provider.kind);
        const appSignIn = provider.appSignInMetadata;
        if (provider.appSignIn !== true || !appSignIn || !definition) return [];
        return [
          <SettingsSection key={provider.kind} title={provider.label}>
            <AppSignInRow
              environment={props.environment}
              label={appSignIn.appName}
              definition={definition}
              appSignIn={appSignIn}
              disabled={props.disabled}
            />
          </SettingsSection>,
        ];
      })}
    </>
  );
}

function AppSignInRow(props: {
  readonly environment: SettingsTarget;
  readonly label: string;
  readonly definition: SourceControlDefinition;
  readonly appSignIn: SourceControlAppSignIn;
  readonly disabled: boolean;
}) {
  const { environment, definition, appSignIn } = props;
  const environmentId = environment.environmentId;
  const host = appSignIn.hosts[0] ?? "";
  const { signIns } = readHostCredentialSettings(
    environment.serverConfig.settings,
    definition.kind,
  );
  const signedIn = (signIns[host] ?? "").length > 0;
  const start = useAtomCommand(sourceControlEnvironment.startSignIn, { reportFailure: false });
  const wait = useAtomCommand(sourceControlEnvironment.waitForSignIn, { reportFailure: false });
  const cancel = useAtomCommand(sourceControlEnvironment.cancelSignIn, { reportFailure: false });

  const attempt = useRef<SourceControlSignInPrompt | null>(null);
  const input = { provider: definition.kind, host };
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: `sign out of ${appSignIn.appName}`,
  });
  const [pending, setPending] = useState<SourceControlSignInPrompt | "starting" | null>(null);

  const showCode = (prompt: SourceControlSignInPrompt) => {
    void Clipboard.setStringAsync(prompt.userCode).catch(() => undefined);
    Alert.alert(
      prompt.userCode,
      `Enter this code on the provider’s sign-in page, then approve ${appSignIn.appName}. It is copied. The server finishes signing in even if you leave the app.`,
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            attempt.current = null;
            setPending(null);
            void cancel({ environmentId, input });
          },
        },
        { text: "Open sign-in page", onPress: () => openUrl(prompt.verificationUri) },
      ],
    );
  };

  const signIn = async () => {
    setPending("starting");
    const started = await start({ environmentId, input });
    if (started._tag !== "Success") {
      setPending(null);
      Alert.alert("Could not start the sign-in", failureMessage(started.cause));
      return;
    }
    const prompt = started.value;
    attempt.current = prompt;
    setPending(prompt);
    showCode(prompt);
    const finished = await wait({ environmentId, input });
    if (attempt.current !== prompt) return;
    attempt.current = null;
    setPending(null);
    if (finished._tag !== "Success") {
      Alert.alert("Sign-in did not finish", failureMessage(finished.cause));
    }
  };

  const signOut = () =>
    void updateSettings({
      environmentId,

      input: {
        patch: {
          sourceControlHosts: { [definition.kind]: { signIns: { ...signIns, [host]: "" } } },
        },
      },
    });

  const onPress = () => {
    if (signedIn) {
      Alert.alert(
        appSignIn.appName,
        "Signed in. Repository requests use the app's access, in repositories where the app is installed.",
        [
          { text: "Install on an organization", onPress: () => openUrl(appSignIn.installUrl) },
          { text: "Revoke access", onPress: () => openUrl(appSignIn.revokeUrl) },
          { text: "Sign out", style: "destructive", onPress: signOut },
          { text: "Cancel", style: "cancel" },
        ],
      );
    } else if (pending !== null && pending !== "starting") {
      showCode(pending);
    } else if (pending === null) {
      void signIn();
    }
  };

  return (
    <SettingsRow
      icon="person.crop.circle"
      label={props.label}
      value={
        signedIn
          ? "Signed in"
          : pending === "starting"
            ? "Starting…"
            : pending !== null
              ? `Enter ${pending.userCode}`
              : "Sign in"
      }
      disabled={props.disabled}
      onPress={onPress}
    />
  );
}
