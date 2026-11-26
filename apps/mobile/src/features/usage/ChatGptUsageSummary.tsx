import { collectExternalUsageLinks } from "@supaterm/shared/usageLimitsCopy";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@supaterm/contracts";
import { CHATGPT_USAGE_URL } from "@supaterm/shared/usageLimits";
import { Pressable, View } from "react-native";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { AppText as Text } from "../../components/ui/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { environmentPresentations } from "../../state/presentation";
import { T, useMessages, Var } from "gt-react-native";

export function ChatGptUsageSummary({
  selectedEnvironmentIds,
}: {
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
}) {
  const m = useMessages();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const selected =
    selectedEnvironmentIds === null
      ? presentations
      : new Map([...presentations].filter(([id]) => selectedEnvironmentIds.has(id)));
  const usage = collectExternalUsageLinks(selected, m).find(
    (link) => link.url === CHATGPT_USAGE_URL,
  );
  if (!usage) return null;
  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-2">
          <ProviderIcon provider="codex" size={16} />
          <Text className="text-sm text-foreground">
            <T>ChatGPT shared usage</T>
          </Text>
        </View>
        <Pressable
          accessibilityRole="link"
          className="min-h-11 justify-center"
          onPress={() => void tryOpenExternalUrl(usage.url)}
        >
          <Text className="text-sm font-supaterm-medium text-primary">
            <T>Manage usage</T>
          </Text>
        </Pressable>
      </View>
      <Text className="text-xs text-foreground-muted">
        <T>
          <Var>{usage.accounts.join(", ")}</Var>. Open ChatGPT with the account you connected.
        </T>
      </Text>
    </View>
  );
}
