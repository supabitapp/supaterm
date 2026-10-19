import * as Dialog from "../../components/ui/Dialog";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import type { ProviderAuthResponse, ServerProvider } from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { Linking, Pressable, ScrollView, TextInput, View } from "react-native";
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
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsActionRow } from "./components/SettingsActionRow";
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
  const providersByEnvironment = useAtomValue(environmentPresentations.providersByEnvironmentAtom);
  const insets = useSafeAreaInsets();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Provider accounts" trailing={<AndroidSettingsEnvironmentFilter />}>
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
            selectedTargets.map((environment) => {
              const providers = (
                providersByEnvironment.get(environment.environmentId) ?? []
              ).filter(
                (provider) =>
                  provider.setup?.canAuthenticate ||
                  (provider.driver === "acpRegistry" && provider.installed),
              );
              return (
                <SettingsSection key={environment.environmentId} title={environment.label}>
                  {providers.map((provider, index) => (
                    <ProviderAccount
                      key={provider.instanceId}
                      environment={environment}
                      provider={provider}
                      isLast={index === providers.length - 1}
                    />
                  ))}
                  {providers.length === 0 ? (
                    <View className="gap-1 p-4">
                      <Text className="text-base font-supaterm-medium text-foreground">
                        No accounts to connect
                      </Text>
                      <Text className="text-sm text-foreground-muted">
                        Add a provider in web or desktop Settings → Providers.
                      </Text>
                    </View>
                  ) : null}
                </SettingsSection>
              );
            })
          )}
        </ScreenScrollView>
      </SettingsScreen>
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
    if (choosingMethod) return "Choose how to sign in below.";
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
  function chooseMethod() {
    const methods = state?.methods ?? [];
    if (methods.length <= 1) {
      void run(() => start(target));
      return;
    }
    setChoosingMethod(true);
  }
  return (
    <View className={isLast ? undefined : "border-b border-border-subtle"}>
      <View className="gap-2 p-4">
        <View
          className={cn(
            "flex-row items-center gap-3",
            unavailable && !active ? "min-h-6" : "min-h-12",
          )}
        >
          <View accessible={false} importantForAccessibility="no-hide-descendants">
            <ProviderIcon provider={provider.driver} iconUrl={provider.iconUrl} size={24} />
          </View>
          <Text className="min-w-0 flex-1 text-base font-supaterm-medium text-foreground">
            {provider.displayName ?? provider.driver}
          </Text>
          {showSignIn ? (
            <Button
              label={signInLabel()}
              disabled={disabled}
              loading={pending}
              onPress={chooseMethod}
            />
          ) : loading ? (
            <AppActivityIndicator
              accessibilityLabel="Loading account"
              colorClassName="accent-icon"
            />
          ) : !active && unavailable ? (
            <Text className="text-sm text-foreground-muted">
              {provider.enabled ? "Not installed" : "Disabled"}
            </Text>
          ) : !active && auth.error ? (
            <Button label="Retry" onPress={auth.refresh} />
          ) : null}
        </View>
        <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
          {accountDescription()}
        </Text>
        {signedIn && !active && provider.auth.email?.trim() ? (
          <ProviderAccountEmail key={provider.auth.email} email={provider.auth.email} />
        ) : null}
        {interaction?.type === "deviceCode" ? (
          <Text selectable className="text-foreground">
            Enter code {interaction.userCode} on the sign-in page.
          </Text>
        ) : null}
        {interaction?.type === "terminal" ? (
          <>
            <ScrollView className="max-h-64" nestedScrollEnabled>
              <Text selectable className="font-mono text-sm text-foreground">
                {interaction.output.replace(TERMINAL_CONTROL_SEQUENCE, "")}
              </Text>
            </ScrollView>
            {field("input", "Terminal response", true)}
            <SettingsActionRow
              icon="arrow.up"
              label="Send response"
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
              label="Connect"
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
              If the browser can’t open the final page, paste its full address below.
            </Text>
            {field("callback", "Return URL", false)}
            <SettingsActionRow
              icon="arrow.right"
              label="Continue"
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
          <SettingsActionRow icon="xmark" label="Cancel" onPress={() => setChoosingMethod(false)} />
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
      {needsExternalSetup && provider.setup?.documentationUrl ? (
        <SettingsActionRow
          icon="globe"
          label="Open docs"
          onPress={() => {
            void Linking.openURL(provider.setup!.documentationUrl!).catch(() =>
              setError("Could not open the provider docs."),
            );
          }}
        />
      ) : active && state?.flowId ? (
        <SettingsActionRow
          icon="xmark"
          label="Cancel sign-in"
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
          label="Sign out"
          tone="danger"
          disabled={disabled || state === null}
          onPress={() =>
            Dialog.alert(
              "Sign out?",
              `Running threads sharing this sign-in on ${environment.label} will stop. Thread history is kept.`,
              [
                {
                  text: "Cancel",
                  style: "cancel",
                },
                {
                  text: "Sign out",
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
function ProviderAccountEmail({ email }: { readonly email: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={revealed ? "Hide account email" : "Reveal account email"}
      onPress={() => setRevealed((value) => !value)}
      className="min-h-[44px] justify-center"
    >
      <Text className="text-sm text-foreground-muted">{revealed ? email : "••••••@••••••"}</Text>
    </Pressable>
  );
}
