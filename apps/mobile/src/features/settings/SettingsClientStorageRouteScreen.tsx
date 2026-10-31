import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { type EnvironmentMachineKind, resolveEnvironmentMachineKind } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ENVIRONMENT_MACHINE_SYMBOLS } from "../../components/EnvironmentMachineSymbol";
import { useInlineConfirm } from "../../lib/useInlineConfirm";
import {
  clearClientCacheAtom,
  clientCacheSummaryAtom,
  type EnvironmentClientCacheSummary,
} from "../../state/client-cache-state";
import { useServerConfigs } from "../../state/entities";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";

export function SettingsClientStorageRouteScreen() {
  const insets = useSafeAreaInsets();
  const summaryResult = useAtomValue(clientCacheSummaryAtom);
  const clearResult = useAtomValue(clearClientCacheAtom);
  const clearCache = useAtomSet(clearClientCacheAtom);
  const { savedConnectionsById } = useSavedRemoteConnections();
  const serverConfigs = useServerConfigs();
  const isClearing = clearResult.waiting;
  const confirm = useInlineConfirm<"all">();
  const summary = AsyncResult.isSuccess(summaryResult) ? summaryResult.value : null;
  const clearAllLabel = summary ? `Clear ${formatBytes(summary.payloadBytes)}` : "Clear caches";
  const environmentSummaries = useMemo(
    () =>
      [...(summary?.environments ?? [])].sort((left, right) => {
        const leftLabel = savedConnectionsById[left.environmentId]?.environmentLabel ?? "";
        const rightLabel = savedConnectionsById[right.environmentId]?.environmentLabel ?? "";
        return leftLabel.localeCompare(rightLabel);
      }),
    [savedConnectionsById, summary?.environments],
  );

  return (
    <SettingsScreen title="Client Storage">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentInset={{ bottom: Math.max(insets.bottom, 18) }}
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4 pb-[18px]"
      >
        <SettingsSection title="Environment caches">
          {AsyncResult.isFailure(summaryResult) ? (
            <View className="items-center gap-2 px-6 py-8">
              <SymbolView
                name="exclamationmark.triangle"
                size={28}
                tintColorClassName="accent-danger-foreground"
                type="monochrome"
                weight="regular"
              />
              <Text className="text-center text-base text-foreground">Storage unavailable</Text>
              <Text className="text-center text-sm text-foreground-muted">
                Restart the app and try again.
              </Text>
            </View>
          ) : !summary ? (
            <View className="items-center gap-3 px-6 py-8">
              <AppActivityIndicator />
              <Text className="text-center text-sm text-foreground-muted">
                Inspecting cached data…
              </Text>
            </View>
          ) : (
            <>
              <View>
                {environmentSummaries.map((environment, index) => (
                  <Animated.View
                    key={environment.environmentId}
                    entering={FadeIn.duration(140)}
                    exiting={FadeOut.duration(120)}
                    layout={LinearTransition.duration(180)}
                  >
                    <CacheEnvironmentRow
                      environment={environment}
                      environmentLabel={
                        savedConnectionsById[environment.environmentId]?.environmentLabel ??
                        environment.environmentId
                      }
                      machine={resolveEnvironmentMachineKind(
                        serverConfigs.get(environment.environmentId) ?? null,
                      )}
                      disabled={isClearing}
                      first={index === 0}
                      onClear={() =>
                        clearCache({
                          type: "environment",
                          environmentId: environment.environmentId,
                        })
                      }
                    />
                  </Animated.View>
                ))}
              </View>
              {environmentSummaries.length === 0 ? (
                <View className="items-center gap-2 px-6 py-8">
                  <SymbolView
                    name="checkmark.circle"
                    size={28}
                    tintColorClassName="accent-icon"
                    type="monochrome"
                    weight="regular"
                  />
                  <Text className="text-center text-base text-foreground">No cached data</Text>
                  <Text className="text-center text-sm text-foreground-muted">
                    Offline cache records will appear here after environments are used.
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </SettingsSection>

        <View className="gap-3">
          <SettingsSection title="Actions">
            <SettingsActionRow
              icon="trash"
              label={confirm.armed === "all" ? "Confirm clearing all caches" : clearAllLabel}
              tone="danger"
              disabled={isClearing || !summary || summary.recordCount === 0}
              loading={isClearing}
              {...confirm.bind("all", () => clearCache({ type: "all" }))}
            />
          </SettingsSection>
          <Text className="px-2 text-sm leading-normal text-foreground-muted">
            Clearing caches never removes environment connections, credentials, account data, or
            appearance preferences.
          </Text>
          {AsyncResult.isFailure(summaryResult) || AsyncResult.isFailure(clearResult) ? (
            <Text selectable className="px-2 text-sm text-danger-foreground">
              Client storage is temporarily unavailable. Try again after restarting the app.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SettingsScreen>
  );
}

function CacheEnvironmentRow(props: {
  readonly environment: EnvironmentClientCacheSummary;
  readonly environmentLabel: string;
  readonly machine: EnvironmentMachineKind;
  readonly disabled: boolean;
  readonly first: boolean;
  readonly onClear: () => void;
}) {
  const confirm = useInlineConfirm<"clear">();
  const armed = confirm.armed === "clear";
  return (
    <View className={props.first ? undefined : "border-t border-border"}>
      <SettingsActionRow
        icon={ENVIRONMENT_MACHINE_SYMBOLS[props.machine]}
        label={props.environmentLabel}
        description={
          armed
            ? `Confirm clearing cache for ${props.environmentLabel}`
            : `Clear ${formatBytes(props.environment.payloadBytes)} of cached data`
        }
        tone="danger"
        disabled={props.disabled}
        {...confirm.bind("clear", props.onClear)}
      />
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
