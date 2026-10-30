import type {
  EnvironmentId,
  SourceControlAppAccess,
  SourceControlAppAccessInput,
  SourceControlProviderDiscoveryItem,
} from "@supaterm/contracts";
import { appSignInTargetForRemote } from "@supaterm/client-runtime/source-control-clients";
import type { AtomCommandResult } from "@supaterm/client-runtime/state/runtime";
import { Alert, Linking } from "react-native";

export async function suggestAppAccessForRemote(
  check: (value: {
    readonly environmentId: EnvironmentId;
    readonly input: SourceControlAppAccessInput;
  }) => Promise<AtomCommandResult<SourceControlAppAccess, unknown>>,
  environmentId: EnvironmentId,
  remoteUrl: string,
  discovery: ReadonlyArray<SourceControlProviderDiscoveryItem>,
): Promise<void> {
  const target = appSignInTargetForRemote(remoteUrl, discovery);
  if (target === null) return;
  const result = await check({ environmentId, input: target.input });
  if (result._tag !== "Success" || result.value.status !== "not-covered") return;
  const owner = target.input.repository.split("/")[0] ?? target.input.repository;
  Alert.alert(
    `Give ${target.appSignIn.appName} access to ${owner}`,
    `It isn't installed there, so repository requests for ${target.input.repository} use your own login and its lower rate limit.`,
    [
      { text: "Not now", style: "cancel" },
      {
        text: "Install",
        onPress: () => void Linking.openURL(target.appSignIn.installUrl).catch(() => undefined),
      },
    ],
  );
}
