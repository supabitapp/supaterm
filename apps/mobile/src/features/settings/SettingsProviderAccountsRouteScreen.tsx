import * as Dialog from "../../components/ui/Dialog";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  type ProviderAuthResponse,
  type ServerProvider,
} from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { Linking, Pressable, ScrollView, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { MenuAction } from "@react-native-menu/menu";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { cn } from "../../lib/cn";
import { environmentPresentations } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
const TERMINAL_CONTROL_SEQUENCE = new RegExp(
  `${String.fromCharCode(0x1b)}\\[[0-?]*[ -/]*[@-~]`,
  "g",
);
export function SettingsProviderAccountsRouteScreen() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const permittedEnvironments = useEnvironmentsWithScope(selectedTargets, AuthProvidersManageScope);
  const providersByEnvironment = useAtomValue(environmentPresentations.providersByEnvironmentAtom);
  const insets = useSafeAreaInsets();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Providers" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScreenScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom, 18) + 18,
          }}
        >
          <Text className="px-2 text-sm text-foreground-muted">
            Accounts are saved on the environment that runs your agents.
          </Text>
          {selectedTargets.length === 0 ? (
            <Text className="px-2 text-sm text-foreground-muted">
              Select a connected environment with the filter above.
            </Text>
          ) : (
            selectedTargets.map((environment) => (
              <SettingsSection key={environment.environmentId} title={environment.label}>
                {!permittedEnvironments.has(environment.environmentId) ? (
                  <View className="gap-1 p-4">
                    <Text className="text-base text-foreground">Limited permissions</Text>
                    <Text className="text-sm text-foreground-muted">
                      {`This session can view ${environment.label}'s providers but can't change their settings.`}
                    </Text>
                  </View>
                ) : (
                  <>
                    {(providersByEnvironment.get(environment.environmentId) ?? [])
                      .filter(canManageProvider)
                      .map((provider, index) => (
                        <ProviderAccount
                          key={provider.instanceId}
                          environment={environment}
                          provider={provider}
                          divider={index > 0}
                        />
                      ))}
                    {!(providersByEnvironment.get(environment.environmentId) ?? []).some(
                      canManageProvider,
                    ) ? (
                      <Text className="p-4 text-foreground-muted">
                        Configure a provider with in-app sign-in in web or desktop Settings.
                      </Text>
                    ) : null}
                  </>
                )}
              </SettingsSection>
            ))
          )}
        </ScreenScrollView>
      </SettingsScreen>
    </>
  );
}

function canManageProvider(provider: ServerProvider) {
  return Boolean(
    provider.setup?.canAuthenticate || (provider.driver === "acpRegistry" && provider.installed),
  );
}

function ProviderAccount({
  environment,
  provider,
  divider,
}: {
  readonly environment: SettingsTarget;
  readonly provider: ServerProvider;
  readonly divider: boolean;
}) {
  const environmentId = environment.environmentId;
  const instanceId = provider.instanceId;
  const target = {
    environmentId,
    input: {
      instanceId,
    },
  };
  const auth = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const options = {
    reportFailure: false,
    reportDefect: false,
  };
  const start = useAtomCommand(serverEnvironment.startProviderAuth, options);
  const respond = useAtomCommand(serverEnvironment.respondProviderAuth, options);
  const complete = useAtomCommand(serverEnvironment.completeProviderAuth, options);
  const cancel = useAtomCommand(serverEnvironment.cancelProviderAuth, options);
  const logout = useAtomCommand(serverEnvironment.logoutProviderAuth, options);
  // Matches ListRowLayout: large text stacks the action below instead of squeezing the status.
  const stacked = useWindowDimensions().fontScale >= 1.5;
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    id: "",
    values: {} as Record<string, string>,
  });
  const state = auth.data;
  const interaction = state?.interaction;
  const draftId = `${state?.flowId ?? ""}:${interaction?.id ?? ""}`;
  const values = draft.id === draftId ? draft.values : {};
  const active =
    state?.phase === "starting" || state?.phase === "waiting" || state?.phase === "verifying";
  const signedIn =
    provider.auth.status === "authenticated" ||
    (provider.auth.status === "unknown" && state?.phase === "succeeded");
  const isDiscovering =
    provider.driver === "acpRegistry" &&
    !active &&
    !signedIn &&
    !auth.error &&
    state?.methods === undefined;
  const needsExternalSetup =
    !active &&
    !signedIn &&
    (provider.setup?.canAuthenticate === false ||
      (provider.driver === "acpRegistry" && state?.methods?.length === 0));
  const url =
    interaction?.type === "browser" || interaction?.type === "deviceCode"
      ? interaction.url
      : state?.authorizationUrl;
  const disabled = pending || auth.error !== null || isDiscovering;
  const unavailable = !provider.enabled || !provider.installed;
  const loading = !unavailable && !auth.error && (state === null || isDiscovering);
  const showSignIn =
    !active &&
    !unavailable &&
    !needsExternalSetup &&
    provider.setup?.canAuthenticate !== false &&
    !loading &&
    !auth.error;
  function signInLabel() {
    if (pending) return "Working…";
    if (signedIn) return "Change account";
    if (state?.phase === "failed" || state?.phase === "cancelled") return "Retry sign-in";
    return "Sign in";
  }
  function accountDescription() {
    if (active) return state.message;
    if (!provider.enabled) return "Enable in web or desktop Settings → Providers.";
    if (!provider.installed)
      return "Install on this environment in web or desktop Settings → Providers.";
    if (auth.error) return "Couldn’t load account status.";
    if (loading) return isDiscovering ? "Finding sign-in methods…" : "Loading account…";
    if (state?.phase === "failed" || state?.phase === "cancelled") return state.message;
    if (signedIn) return "Signed in.";
    if (needsExternalSetup) return "Follow the provider’s setup guide to sign in.";
    return "Not signed in.";
  }
  async function run(command: () => Promise<AtomCommandResult<unknown, unknown>>) {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const result = await command();
    pendingRef.current = false;
    setPending(false);
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not update provider sign-in.");
    }
    return false;
  }
  function send(response: ProviderAuthResponse) {
    if (!state?.flowId || !interaction) return Promise.resolve(false);
    return run(() =>
      respond({
        environmentId,
        input: {
          instanceId,
          flowId: state.flowId!,
          interactionId: interaction.id,
          response,
        },
      }),
    );
  }
  function field(name: string, label: string, secret: boolean) {
    return (
      <View className="gap-1.5">
        <Text className="text-sm font-supaterm-medium text-foreground">{label}</Text>
        <TextInput
          accessibilityLabel={label}
          className="min-h-11 rounded-lg border border-border-subtle px-3 py-2 text-base text-foreground"
          placeholderTextColorClassName="accent-foreground-muted"
          secureTextEntry={secret}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={name === "callback" ? "url" : "default"}
          editable={!disabled}
          maxLength={secret && interaction?.type === "terminal" ? 4_095 : 16_384}
          value={values[name] ?? ""}
          onChangeText={(value) =>
            setDraft({
              id: draftId,
              values: {
                ...values,
                [name]: value,
              },
            })
          }
        />
      </View>
    );
  }
  const name = provider.displayName ?? provider.driver;
  const email = signedIn && !active && provider.enabled ? provider.auth.email?.trim() : undefined;
  const methods = state?.methods ?? [];
  // The status line says why a provider that is missing or turned off can't sign in.
  const canSignIn =
    !active &&
    !needsExternalSetup &&
    provider.setup?.canAuthenticate !== false &&
    provider.enabled &&
    provider.installed;
  const signInDisabled = disabled || state === null;
  const canSignOut =
    !active && signedIn && (provider.auth.canLogout ?? provider.setup?.canAuthenticate);
  const showCallback =
    Boolean(url) && (interaction?.type === "browser" ? interaction.acceptsCallback : !interaction);
  const status =
    active || state?.phase === "failed" || state?.phase === "cancelled"
      ? state.message
      : !provider.enabled
        ? "Turned off"
        : signedIn
          ? "Signed in"
          : isDiscovering
            ? "Discovering sign-in methods…"
            : needsExternalSetup
              ? "No in-app sign-in advertised. Follow the provider's docs to finish setup."
              : !provider.installed
                ? "Not installed"
                : "Not signed in";
  // A provider with several sign-in methods picks one from a menu on the same control.
  const methodActions: MenuAction[] = methods.map((method) => ({
    id: `method:${method.id}`,
    title: method.name,
  }));
  function startSignIn(methodId?: string) {
    void run(() => start(methodId ? { environmentId, input: { instanceId, methodId } } : target));
  }
  function signOut() {
    Dialog.alert(
      "Sign out?",
      `Running threads sharing this sign-in on ${environment.label} will stop. Thread history is kept.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => {
            void run(() => logout(target));
          },
        },
      ],
    );
  }
  function onMenuAction(id: string) {
    if (id === "signOut") signOut();
    // iOS keeps a disabled submenu's children selectable, so sign-in guards here too.
    else if (signInDisabled) return;
    else if (id.startsWith("method:")) startSignIn(id.slice("method:".length));
    else if (id === "change") startSignIn();
  }
  const accountActions: MenuAction[] = [
    ...(canSignIn
      ? [
          {
            id: "change",
            title: "Change account",
            image: "person.crop.circle",
            attributes: { disabled: signInDisabled },
            ...(methodActions.length > 1
              ? {
                  subactions: methodActions.map((action) => ({
                    ...action,
                    attributes: { disabled: signInDisabled },
                  })),
                }
              : {}),
          },
        ]
      : []),
    ...(canSignOut
      ? [
          {
            id: "signOut",
            title: "Sign out",
            image: "rectangle.portrait.and.arrow.right",
            attributes: { destructive: true, disabled: disabled || state === null },
          },
        ]
      : []),
  ];
  const trailing = pending ? (
    <View className="h-11 w-11 items-center justify-center">
      <AppActivityIndicator colorClassName="accent-icon" />
    </View>
  ) : needsExternalSetup && provider.setup?.documentationUrl ? (
    <ControlPill
      variant="pill"
      label="Docs"
      onPress={() => {
        void Linking.openURL(provider.setup!.documentationUrl!).catch(() =>
          setError("Could not open the provider docs."),
        );
      }}
    />
  ) : active && state?.flowId ? (
    <ControlPill
      variant="pill"
      label="Cancel"
      accessibilityLabel={`Cancel ${name} sign-in`}
      disabled={disabled}
      onPress={() => {
        void run(() => cancel({ environmentId, input: { instanceId, flowId: state.flowId! } }));
      }}
    />
  ) : signedIn && !active && accountActions.length > 0 ? (
    <Menu
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${name} account options`}
      title={name}
      actions={accountActions}
      onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
    >
      <ControlPill icon="ellipsis" accessibilityLabel={`${name} account options`} />
    </Menu>
  ) : canSignIn && !signedIn && methodActions.length > 1 && !signInDisabled ? (
    <Menu
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Sign in to ${name}`}
      title="Sign in with"
      actions={methodActions}
      onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
    >
      <ControlPill variant="primary" label="Sign in" accessibilityLabel={`Sign in to ${name}`} />
    </Menu>
  ) : canSignIn && !signedIn ? (
    <ControlPill
      variant="primary"
      label="Sign in"
      accessibilityLabel={`Sign in to ${name}`}
      disabled={signInDisabled}
      onPress={() => startSignIn()}
    />
  ) : null;
  return (
    <View className={divider ? "border-t border-border-subtle" : undefined}>
      <View
        className={
          stacked
            ? "min-h-16 items-start gap-3 px-4 py-3"
            : "min-h-16 flex-row items-center gap-3 px-4 py-3"
        }
      >
        <ProviderAccountSummary key={email} name={name} status={status} email={email} />
        {trailing}
      </View>
      {interaction?.type === "deviceCode" ||
      interaction?.type === "terminal" ||
      interaction?.type === "credentials" ||
      showCallback ||
      error ||
      auth.error ? (
        <View className="gap-2 px-4 pb-3">
          {interaction?.type === "deviceCode" ? (
            <Text selectable className="text-foreground">
              Enter code {interaction.userCode} on the sign-in page.
            </Text>
          ) : null}
          {interaction?.type === "terminal" ? (
            <>
              <ScrollView className="max-h-64" nestedScrollEnabled>
                <Text selectable className="font-mono text-sm text-foreground">
                  {interaction.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")}
                </Text>
              </ScrollView>
              {field("input", "Terminal response", true)}
              <SettingsActionRow
                icon="arrow.up"
                label="Send response"
                disabled={disabled}
                onPress={() => {
                  void send({ type: "terminal", data: `${values.input ?? ""}\r` }).then((sent) => {
                    if (sent) setDraft({ id: "", values: {} });
                  });
                }}
              />
            </>
          ) : null}
          {interaction?.type === "credentials" ? (
            <>
              {interaction.fields.map((entry) => (
                <View key={entry.name}>{field(entry.name, entry.label, entry.secret)}</View>
              ))}
              <SettingsActionRow
                icon="person.crop.circle"
                label="Connect"
                disabled={disabled}
                onPress={() => {
                  void send({ type: "credentials", values }).then((sent) => {
                    if (sent) setDraft({ id: "", values: {} });
                  });
                }}
              />
            </>
          ) : null}
          {showCallback ? (
            <>
              {field("callback", "Final localhost URL", false)}
              <SettingsActionRow
                icon="arrow.right"
                label="Continue"
                disabled={disabled || !values.callback?.trim()}
                onPress={() => {
                  if (!state?.flowId) return;
                  void run(() =>
                    complete({
                      environmentId,
                      input: { instanceId, flowId: state.flowId!, callbackUrl: values.callback! },
                    }),
                  ).then((sent) => {
                    if (sent) setDraft({ id: "", values: {} });
                  });
                }}
              />
            </>
          ) : null}
          {error || auth.error ? (
            <Text accessibilityRole="alert" className="text-danger-foreground">
              {error ?? auth.error}
            </Text>
          ) : null}
        </View>
      ) : null}
      {url ? (
        <SettingsActionRow
          icon="globe"
          label="Open sign-in page"
          disabled={disabled}
          onPress={() => {
            void (async () => {
              if (
                interaction?.type === "browser" &&
                interaction.requiresConsent &&
                !(await send({
                  type: "browser",
                  action: "accept",
                }))
              )
                return;
              await Linking.openURL(url);
            })().catch(() => setError("Could not open the sign-in page."));
          }}
        />
      ) : null}
    </View>
  );
}

function ProviderAccountSummary({
  name,
  status,
  email,
}: {
  readonly name: string;
  readonly status: string | null | undefined;
  readonly email: string | undefined;
}) {
  const [revealed, setRevealed] = useState(false);
  const content = (
    <>
      <Text textRole="body" className="text-foreground" numberOfLines={1}>
        {name}
      </Text>
      <Text accessibilityLiveRegion="polite" textRole="footnote" className="text-foreground-muted">
        {email ? `${status} · ${revealed ? email : "••••••@••••••"}` : status}
      </Text>
    </>
  );
  if (!email) {
    return (
      <View
        accessible
        accessibilityLabel={[name, status].filter(Boolean).join(", ")}
        className="min-w-0 shrink grow gap-0.5"
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, status, revealed ? email : null].filter(Boolean).join(", ")}
      accessibilityHint={revealed ? "Hides the account email" : "Reveals the account email"}
      onPress={() => setRevealed((value) => !value)}
      className="min-w-0 shrink grow gap-0.5"
    >
      {content}
    </Pressable>
  );
}
