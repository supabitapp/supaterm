import { EnvironmentId } from "@supaterm/contracts";
import {
  readHostCredentialSettings,
  sourceControlClients,
} from "@supaterm/client-runtime/source-control-clients";
import { Linking, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";

export function SourceControlAppAccessNotice(props: {
  readonly environmentId: string;
  readonly provider: string | undefined;
  readonly host: string | undefined;

  readonly repository: string;
}) {
  const environmentId = EnvironmentId.make(props.environmentId);
  const { presentation } = useEnvironmentPresentation(environmentId);
  const definition = props.provider ? sourceControlClients.find(props.provider) : undefined;
  const appSignIn = definition?.credentials?.appSignIn;
  const host = (props.host ?? definition?.publicHost ?? "").toLowerCase();
  const settings = presentation?.serverConfig?.settings;
  const signedIn =
    definition !== undefined &&
    settings !== undefined &&
    (readHostCredentialSettings(settings, definition.kind).signIns[host] ?? "").length > 0;
  const access = useEnvironmentQuery(
    definition !== undefined && appSignIn?.hosts.includes(host) && signedIn
      ? sourceControlEnvironment.appAccess({
          environmentId,
          input: { provider: definition.kind, host, repository: props.repository },
        })
      : null,
  );
  if (appSignIn === undefined || access.data?.status !== "not-covered") return null;
  const owner = props.repository.split("/")[0] ?? props.repository;

  return (
    <View className="mb-4 gap-1 rounded-2xl bg-grouped-card px-4 py-3">
      <Text className="text-sm text-foreground-muted">
        {appSignIn.appName} isn't installed on {owner}. Requests use your configured account
        credentials until you grant the app repository access.
      </Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(appSignIn.installUrl).catch(() => undefined)}
      >
        <Text className="text-sm font-supaterm-bold text-foreground">Install on {owner}</Text>
      </Pressable>
    </View>
  );
}
