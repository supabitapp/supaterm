import * as Dialog from "../../components/ui/Dialog";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  isManagedDriverAllowed,
  type ProviderAuthResponse,
  type ServerProvider,
} from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from "react-native";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ProviderIcon } from "../../components/ProviderIcon";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { cn } from "../../lib/cn";
import { environmentPresentations } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { AddClaudeAccount, ClaudeAccount } from "./ClaudeAccounts";
import { CLAUDE_DRIVER } from "./claude-accounts";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { useGT, T, Var } from "gt-react-native";
const TERMINAL_CONTROL_SEQUENCE = new RegExp(
  `${String.fromCharCode(0x1b)}\\[[0-?]*[ -/]*[@-~]`,
  "g",
);
export function SettingsProviderAccountsRouteScreen() {
  const gt = useGT();
  const environmentMenu = useSettingsEnvironmentMenu();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const permittedEnvironments = useEnvironmentsWithScope(selectedTargets, AuthProvidersManageScope);
  const providersByEnvironment = useAtomValue(environmentPresentations.providersByEnvironmentAtom);
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title={gt("Providers")} menus={[environmentMenu]}>
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
        }}
      >
        <Text className="px-2 text-sm text-foreground-muted">
          <T>Accounts are saved on the environment that runs your agents.</T>
        </Text>
        {selectedTargets.length === 0 ? (
          <Text className="px-2 text-sm text-foreground-muted">
            <T>Select a connected environment with the filter above.</T>
          </Text>
        ) : (
          selectedTargets.map((environment) => (
            <SettingsSection key={environment.environmentId} title={environment.label}>
              {!permittedEnvironments.has(environment.environmentId) ? (
                <View className="gap-1 p-4">
                  <Text className="text-base font-supaterm-medium text-foreground">
                    <T>Limited permissions</T>
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    {gt(
                      "This session can view {environment}''s providers but can't change their settings.",
                      { environment: environment.label },
                    )}
                  </Text>
                </View>
              ) : (
                <EnvironmentProviders
                  environment={environment}
                  providers={(providersByEnvironment.get(environment.environmentId) ?? []).filter(
                    (provider) =>
                      isManagedDriverAllowed(
                        environment.serverConfig.managedPolicy,
                        provider.driver,
                      ),
                  )}
                />
              )}
            </SettingsSection>
          ))
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
function canManageProvider(provider: ServerProvider) {
  return (
    provider.setup?.canAuthenticate === true ||
    (provider.driver === "acpRegistry" && provider.installed)
  );
}

function EnvironmentProviders({
  environment,
  providers,
}: {
  readonly environment: SettingsTarget;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const accounts = providers.filter(canManageProvider);
  // Claude has no in-app sign-in; each account is its own instance on a signed-in config folder.
  const claudeAccounts = providers.filter(
    (provider) => provider.driver === CLAUDE_DRIVER && !canManageProvider(provider),
  );
  return (
    <>
      {accounts.map((provider, index) => (
        <ProviderAccount
          key={provider.instanceId}
          environment={environment}
          provider={provider}
          isLast={index === accounts.length - 1}
        />
      ))}
      {accounts.length === 0 ? (
        <View className="gap-1 p-4">
          <Text className="text-base font-supaterm-medium text-foreground">
            <T>No accounts to connect</T>
          </Text>
          <Text className="text-sm text-foreground-muted">
            <T>Add a provider in web or desktop Settings → Providers.</T>
          </Text>
        </View>
      ) : null}
      {claudeAccounts.map((provider) => (
        <ClaudeAccount key={provider.instanceId} environment={environment} provider={provider} />
      ))}
      <AddClaudeAccount environment={environment} />
    </>
  );
}

function ProviderAccount({
  environment,
  provider,
  isLast,
}: {
  readonly environment: SettingsTarget;
  readonly provider: ServerProvider;
  readonly isLast: boolean;
}) {
  const gt = useGT();
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
  const removeMethod = useAtomCommand(serverEnvironment.removeProviderAuthMethod, options);
  const canRemoveMethod = useAtomValue(
    serverEnvironment.removeProviderAuthMethod.permissionAtom(environmentId),
  );
  const name = provider.displayName ?? provider.driver;
  // Matches ListRowLayout: large text moves the action below the status instead of squeezing the name.
  const stacked = useWindowDimensions().fontScale >= 1.5;
  const [pending, setPending] = useState(false);
  const [choosingMethod, setChoosingMethod] = useState(false);
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
    !choosingMethod &&
    !loading &&
    !auth.error;
  const usesCredentials =
    provider.driver === "antigravity" &&
    (provider.auth.type === "gemini-api-key" || provider.auth.type === "agent-platform");
  function signInLabels() {
    if (pending)
      return {
        label: gt("Working…"),
        accessibilityLabel: gt("Working on {provider} sign-in", { provider: name }),
      };
    if (signedIn)
      return {
        label: gt("Change account"),
        accessibilityLabel: gt("Change {provider} account", { provider: name }),
      };
    if (state?.phase === "failed" || state?.phase === "cancelled")
      return {
        label: gt("Retry sign-in"),
        accessibilityLabel: gt("Retry {provider} sign-in", { provider: name }),
      };
    if (usesCredentials)
      return {
        label: gt("Connect"),
        accessibilityLabel: gt("Connect to {provider}", { provider: name }),
      };
    return {
      label: gt("Sign in"),
      accessibilityLabel: gt("Sign in to {provider}", { provider: name }),
    };
  }
  function accountDescription() {
    if (active) return state.message;
    if (!provider.enabled) return gt("Enable in web or desktop Settings → Providers.");
    if (!provider.installed)
      return gt("Install on this environment in web or desktop Settings → Providers.");
    if (auth.error) return gt("Couldn’t load account status.");
    if (loading) return isDiscovering ? gt("Finding sign-in methods…") : gt("Loading account…");
    if (state?.phase === "failed" || state?.phase === "cancelled") return state.message;
    if (signedIn) return gt("Signed in.");
    if (needsExternalSetup) return gt("Follow the provider’s setup guide to sign in.");
    if (choosingMethod) return gt("Choose how to sign in below.");
    if (usesCredentials) return gt("Connect to load models.");
    return gt("Not signed in.");
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
      setError(
        failure instanceof Error ? failure.message : gt("Could not update provider sign-in."),
      );
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
  const removableMethods = (state?.methods ?? []).filter((method) => method.canRemove);
  function chooseMethod() {
    const methods = state?.methods ?? [];
    if (methods.length <= 1 && removableMethods.length === 0) {
      void run(() => start(target));
      return;
    }
    setChoosingMethod(true);
  }
  const trailing = showSignIn ? (
    <Button {...signInLabels()} disabled={disabled} loading={pending} onPress={chooseMethod} />
  ) : loading ? (
    <AppActivityIndicator
      accessibilityLabel={gt("Loading {provider} account", { provider: name })}
      colorClassName="accent-icon"
    />
  ) : !active && unavailable ? (
    <Text className="text-sm text-foreground-muted">
      {provider.enabled ? gt("Not installed") : gt("Disabled", { $context: "provider status" })}
    </Text>
  ) : !active && auth.error ? (
    <Button
      label={gt("Retry")}
      accessibilityLabel={gt("Retry loading {provider} account", { provider: name })}
      onPress={auth.refresh}
    />
  ) : null;
  const status = accountDescription();
  return (
    <View className={isLast ? undefined : "border-b border-border-subtle"}>
      <View className="gap-2 p-4">
        <View
          className={cn(
            "flex-row items-center gap-3",
            (unavailable && !active) || stacked ? "min-h-6" : "min-h-12",
          )}
        >
          <View accessible={false} importantForAccessibility="no-hide-descendants">
            <ProviderIcon provider={provider.driver} iconUrl={provider.iconUrl} size={24} />
          </View>
          <Text className="min-w-0 flex-1 text-base font-supaterm-medium text-foreground">
            {name}
          </Text>
          {stacked ? null : trailing}
        </View>
        <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
          {status}
        </Text>
        {signedIn && !active && provider.auth.email?.trim() ? (
          <ProviderAccountEmail
            key={provider.auth.email}
            name={name}
            status={status}
            email={provider.auth.email}
          />
        ) : null}
        {stacked && trailing ? <View className="items-start">{trailing}</View> : null}
        {interaction?.type === "deviceCode" ? (
          <Text selectable className="text-foreground">
            <T>
              Enter code <Var>{interaction.userCode}</Var> on the sign-in page.
            </T>
          </Text>
        ) : null}
        {interaction?.type === "terminal" ? (
          <>
            <ScrollView className="max-h-64" nestedScrollEnabled>
              <Text selectable className="font-mono text-sm text-foreground">
                {interaction.output.replace(TERMINAL_CONTROL_SEQUENCE, "")}
              </Text>
            </ScrollView>
            {field("input", gt("Terminal response"), true)}
            <SettingsActionRow
              icon="arrow.up"
              label={gt("Send response")}
              disabled={disabled}
              onPress={() => {
                void send({
                  type: "terminal",
                  data: `${values.input ?? ""}\r`,
                }).then((sent) => {
                  if (sent)
                    setDraft({
                      id: "",
                      values: {},
                    });
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
              label={gt("Connect")}
              disabled={disabled}
              onPress={() => {
                void send({
                  type: "credentials",
                  values,
                }).then((sent) => {
                  if (sent)
                    setDraft({
                      id: "",
                      values: {},
                    });
                });
              }}
            />
          </>
        ) : null}
        {url && (interaction?.type === "browser" ? interaction.acceptsCallback : !interaction) ? (
          <>
            <Text className="text-sm text-foreground-muted">
              <T>If the browser can’t open the final page, paste its full address below.</T>
            </Text>
            {field("callback", gt("Return URL"), false)}
            <SettingsActionRow
              icon="arrow.right"
              label={gt("Continue")}
              disabled={disabled || !values.callback?.trim()}
              onPress={() => {
                if (!state?.flowId) return;
                void run(() =>
                  complete({
                    environmentId,
                    input: {
                      instanceId,
                      flowId: state.flowId!,
                      callbackUrl: values.callback!,
                    },
                  }),
                ).then((sent) => {
                  if (sent)
                    setDraft({
                      id: "",
                      values: {},
                    });
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
      {choosingMethod && !active ? (
        <View>
          {state?.methods?.map((method) => (
            <SettingsActionRow
              key={method.id}
              icon="person.crop.circle"
              label={method.name}
              accessibilityLabel={gt("Sign in to {provider} with {method}", {
                provider: name,
                method: method.name,
              })}
              disabled={disabled}
              onPress={() => {
                setChoosingMethod(false);
                void run(() =>
                  start({
                    environmentId,
                    input: {
                      instanceId,
                      methodId: method.id,
                    },
                  }),
                );
              }}
            />
          ))}
          {removableMethods.map((method) => (
            <SettingsActionRow
              key={`remove:${method.id}`}
              icon="trash"
              tone="danger"
              label={gt("Remove incomplete {method}", { method: method.name })}
              accessibilityLabel={gt("Remove incomplete {provider} connection {method}", {
                provider: name,
                method: method.name,
              })}
              disabled={disabled || !canRemoveMethod}
              onPress={() => {
                setChoosingMethod(false);
                void run(() =>
                  removeMethod({
                    environmentId,
                    input: {
                      instanceId,
                      methodId: method.id,
                    },
                  }),
                );
              }}
            />
          ))}
          <SettingsActionRow
            icon="xmark"
            label={gt("Cancel")}
            accessibilityLabel={gt("Cancel {provider} sign-in", { provider: name })}
            onPress={() => setChoosingMethod(false)}
          />
        </View>
      ) : null}
      {url ? (
        <SettingsActionRow
          icon="globe"
          label={gt("Open sign-in page")}
          accessibilityLabel={gt("Open {provider} sign-in page", { provider: name })}
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
              if (!(await tryOpenExternalUrl(url, "provider-auth")))
                setError(gt("Could not open the sign-in page."));
            })().catch(() => setError(gt("Could not open the sign-in page.")));
          }}
        />
      ) : null}
      {needsExternalSetup && provider.setup?.documentationUrl ? (
        <SettingsActionRow
          icon="globe"
          label={gt("Open docs")}
          accessibilityLabel={gt("Open {provider} setup docs", { provider: name })}
          onPress={() => {
            void tryOpenExternalUrl(provider.setup!.documentationUrl!).then((opened) => {
              if (!opened) setError(gt("Could not open the provider docs."));
            });
          }}
        />
      ) : active && state?.flowId ? (
        <SettingsActionRow
          icon="xmark"
          label={gt("Cancel sign-in")}
          accessibilityLabel={gt("Cancel {provider} sign-in", { provider: name })}
          disabled={disabled}
          onPress={() => {
            void run(() =>
              cancel({
                environmentId,
                input: {
                  instanceId,
                  flowId: state.flowId!,
                },
              }),
            );
          }}
        />
      ) : null}
      {!active && signedIn && (provider.auth.canLogout ?? provider.setup?.canAuthenticate) ? (
        <SettingsActionRow
          icon="person.crop.circle"
          label={gt("Sign out")}
          accessibilityLabel={gt("Sign out of {provider}", { provider: name })}
          tone="danger"
          disabled={disabled || state === null}
          onPress={() =>
            Dialog.alert(
              gt("Sign out?"),
              gt(
                "Running threads sharing this sign-in on {environment} will stop. Thread history is kept.",
                { environment: environment.label },
              ),
              [
                {
                  text: gt("Cancel"),
                  style: "cancel",
                },
                {
                  text: gt("Sign out"),
                  style: "destructive",
                  onPress: () => {
                    void run(() => logout(target));
                  },
                },
              ],
            )
          }
        />
      ) : null}
    </View>
  );
}
function ProviderAccountEmail({
  name,
  status,
  email,
}: {
  readonly name: string;
  readonly status: string | null;
  readonly email: string;
}) {
  const gt = useGT();
  const [revealed, setRevealed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, status, revealed ? email : null].filter(Boolean).join(", ")}
      accessibilityHint={revealed ? gt("Hides the account email") : gt("Reveals the account email")}
      onPress={() => setRevealed((value) => !value)}
      className="min-h-[44px] justify-center"
    >
      <Text className="text-sm text-foreground-muted">{revealed ? email : "••••••@••••••"}</Text>
    </Pressable>
  );
}
