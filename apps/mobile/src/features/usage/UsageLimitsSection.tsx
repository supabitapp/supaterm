import { RegistryContext, useAtomMount, useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@supaterm/contracts";
import {
  formatResetsIn,
  limitsNotice,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@supaterm/shared/usageLimits";
import { type ReactNode, useContext, useRef, useState } from "react";
import { Atom } from "effect/reactivity";
import { Linking, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { environmentPresentations } from "../../state/presentation";

import { useNowMinuteMs } from "../../lib/clock";
import {
  environmentIdsKey,
  limitsAutoRefreshSetAtom,
  limitsRefreshFailuresAtom,
  refreshEnvironmentLimits,
} from "./usageLimitsRefresh";
import { usageProviderKind, useProviderColors } from "./usageProviders";

const PACE_LABEL = { ahead: "ahead of pace", on: "on pace", under: "under pace" } as const;

type Driver = ServerProvider["driver"];

function useBarColor(driver: Driver): string | null {
  const colors = useProviderColors();
  const kind = usageProviderKind(driver);
  return kind ? colors[kind] : null;
}

function WindowRow(props: {
  readonly window: ServerProviderUsageWindow;
  readonly color: string | null;
  readonly now: number;
}) {
  const { window, now } = props;
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const pace = paceOf(window, now);
  const resetsIn = formatResetsIn(window, now);
  const [barWidth, setBarWidth] = useState(0);
  const tickX =
    timeLeft === null || barWidth < 6
      ? null
      : Math.min(Math.max((barWidth * timeLeft) / 100, 3), barWidth - 3);
  const bar = (
    <View
      className="h-1.5 flex-row overflow-hidden rounded-full bg-subtle"
      style={barWidth > 0 ? { width: barWidth } : undefined}
    >
      <View
        className={
          remaining <= 10
            ? "h-full rounded-full bg-red-500"
            : remaining <= 30
              ? "h-full rounded-full bg-amber-500"
              : "h-full rounded-full bg-foreground"
        }
        style={[
          { flex: remaining },
          remaining > 30 && props.color ? { backgroundColor: props.color } : null,
        ]}
      />
      <View style={{ flex: 100 - remaining }} />
    </View>
  );
  return (
    <View className="gap-1">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-sm text-foreground">{window.label}</Text>
        <Text className="text-sm font-supaterm-medium tabular-nums text-foreground">
          {remaining}% left
        </Text>
      </View>
      <View
        className="h-3 justify-center"
        onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
      >
        {tickX === null ? (
          bar
        ) : (
          <View className="h-1.5">
            {/* Clip the same full-width bar so neither fill proportions nor corner radii change. */}
            {(
              [
                [0, tickX - 3],
                [tickX + 3, barWidth],
              ] as const
            ).map(([start, end]) => (
              <View
                key={start}
                className="absolute top-0 bottom-0 overflow-hidden"
                style={{ left: start, width: end - start }}
              >
                <View style={{ marginLeft: -start }}>{bar}</View>
              </View>
            ))}
          </View>
        )}
        {tickX !== null ? (
          <View
            className="absolute top-px bottom-px w-0.5 rounded-full bg-foreground"
            style={{ left: tickX - 1 }}
          />
        ) : null}
      </View>
      {pace || resetsIn ? (
        <View className="flex-row justify-between gap-3">
          <Text className="text-xs text-foreground-tertiary">{pace ? PACE_LABEL[pace] : ""}</Text>
          <Text className="text-xs tabular-nums text-foreground-tertiary">{resetsIn ?? ""}</Text>
        </View>
      ) : null}
    </View>
  );
}

function AccountInstanceLabel({ value }: { readonly value: string }) {
  const [revealed, setRevealed] = useState(false);
  if (!value.includes("@")) {
    return (
      <Text className="shrink text-xs text-foreground-tertiary" numberOfLines={1}>
        · {value}
      </Text>
    );
  }
  return (
    <Pressable
      className="shrink active:opacity-60"
      accessibilityRole="button"
      accessibilityLabel={revealed ? "Hide account label" : "Reveal account label"}
      onPress={() => setRevealed((current) => !current)}
    >
      <Text className="text-xs text-foreground-tertiary" numberOfLines={1}>
        · {revealed ? value : "••••••@••••••"}
      </Text>
    </Pressable>
  );
}

export function AccountLimits(props: {
  readonly driver: Driver;
  readonly label: string;
  readonly instanceLabel: string;
  readonly detail: string | undefined;
  readonly limits: ServerProvider["usageLimits"];
  readonly now: number;
  readonly first: boolean;
  readonly dense?: boolean;
  readonly trailing?: ReactNode;
  readonly footer?: ReactNode;
}) {
  const { limits, now, dense = false } = props;
  const color = useBarColor(props.driver);
  if (!limits) return null;
  const notice = limitsNotice(limits);
  const externalUsage = limits.externalUsage;
  const padding = dense ? "px-4 py-3" : "p-4";
  return (
    <View
      className={
        props.first ? `gap-3 ${padding}` : `gap-3 border-t border-border-subtle ${padding}`
      }
    >
      <View className="flex-row items-center gap-2">
        <ProviderIcon provider={props.driver} size={16} />
        <View className="min-w-0 flex-1 flex-row items-baseline gap-2">
          <Text className="text-base font-supaterm-medium text-foreground">{props.label}</Text>
          {props.instanceLabel !== props.label ? (
            <AccountInstanceLabel key={props.instanceLabel} value={props.instanceLabel} />
          ) : null}
          {props.detail ? (
            <Text className="shrink text-sm text-foreground-muted" numberOfLines={1}>
              · {props.detail}
            </Text>
          ) : null}
        </View>
        {props.trailing}
      </View>
      {notice ? (
        <Text className="text-sm text-foreground-muted">{notice}</Text>
      ) : (
        <View className="gap-3">
          {limits.windows.map((window) => (
            <WindowRow key={window.id} window={window} color={color} now={now} />
          ))}
        </View>
      )}
      {externalUsage ? (
        <Pressable
          accessibilityRole="link"
          className="min-h-11 justify-center"
          onPress={() => void Linking.openURL(externalUsage.url).catch(() => undefined)}
        >
          <Text className="text-sm font-supaterm-medium text-primary">Manage usage</Text>
        </Pressable>
      ) : null}
      {props.footer}
    </View>
  );
}

const IDLE_ATOM = Atom.make(undefined);

export function useRefreshLimits(
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null = null,
  active = false,
) {
  const registry = useContext(RegistryContext);
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const now = useNowMinuteMs();
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const selected = [...presentations].filter(
    ([environmentId]) =>
      selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId),
  );
  const connectedIds = selected.flatMap(([environmentId, presentation]) =>
    presentation.connection.phase === "connected" ? [environmentId] : [],
  );
  const connectedKey = environmentIdsKey(connectedIds);
  useAtomMount(active && connectedKey !== "" ? limitsAutoRefreshSetAtom(connectedKey) : IDLE_ATOM);
  const failedIds = new Set(
    useAtomValue(limitsRefreshFailuresAtom(environmentIdsKey(selected.map(([id]) => id)))),
  );
  const failedLabels = selected.flatMap(([environmentId, presentation]) =>
    failedIds.has(environmentId) ? [presentation.entry.target.label] : [],
  );

  const refresh = (afterPending: boolean) =>
    Promise.all(
      connectedIds.map((environmentId) =>
        refreshEnvironmentLimits(registry, environmentId, { afterPending }),
      ),
    );
  // Android RefreshControl needs a true-to-false cycle to stop, even with nothing to probe.
  const refreshManually = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    await refresh(false).finally(() => {
      refreshingRef.current = false;
      setRefreshing(false);
    });
  };
  return {
    now,
    refreshing,
    failedLabels,
    refresh: refreshManually,
    refreshAfterEnable: () => refresh(true),
  };
}
