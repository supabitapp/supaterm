import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ServerProvider,
  ServerProviderUsageWindow,
  UsageProviderKind,
} from "@supaterm/contracts";
import {
  elapsedShare,
  formatResetsIn,
  limitsNotice,
  paceOf,
  remainingPercent,
} from "@supaterm/shared/usageLimits";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import { refreshUsageLimits } from "@supaterm/client-runtime/state/usage";
import { Linking, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";

import { useAtomCommand } from "../../state/use-atom-command";
import { useProviderColors } from "./usageProviders";

const PACE_LABEL = { ahead: "ahead of pace", on: "on pace", under: "under pace" } as const;

type Driver = ServerProvider["driver"];

function useBarColor(driver: Driver): string | null {
  const colors = useProviderColors();
  const kind: UsageProviderKind | null =
    driver === "codex" ? "codex" : driver === "claudeAgent" ? "claude" : null;
  return kind ? colors[kind] : null;
}

function WindowRow(props: {
  readonly window: ServerProviderUsageWindow;
  readonly color: string | null;
  readonly now: number;
}) {
  const { window, now } = props;
  const remaining = remainingPercent(window);
  const elapsed = elapsedShare(window, now);
  const timeLeft = elapsed === null ? null : Math.round((1 - elapsed) * 100);
  const pace = paceOf(window, now);
  const resetsIn = formatResetsIn(window, now);
  return (
    <View className="gap-1">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-sm text-foreground">{window.label}</Text>
        <Text className="text-sm font-supaterm-medium tabular-nums text-foreground">
          {remaining}% left
        </Text>
      </View>
      <View className="h-3 justify-center">
        <View className="h-1.5 flex-row overflow-hidden rounded-full bg-subtle">
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
        {timeLeft !== null ? (
          <View
            className="absolute top-0 bottom-0 w-px bg-foreground"
            style={{ left: `${timeLeft}%`, opacity: 0.6 }}
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

export function useRefreshLimits(
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null = null,
  active = false,
) {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [failedEnvironments, setFailedEnvironments] = useState<
    readonly { environmentId: EnvironmentId; label: string }[]
  >([]);
  const refresh = async (automatic = false, afterPending = false) => {
    const connected = [...presentations].filter(
      ([environmentId, presentation]) =>
        presentation.connection.phase === "connected" &&
        (selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId)),
    );
    await Promise.all(
      connected.map(async ([environmentId, presentation]) => {
        const result = await refreshUsageLimits(
          environmentId,
          () => refreshProviders({ environmentId, input: {} }),
          automatic,
          afterPending,
        );
        if (result === undefined) return;
        setFailedEnvironments((previous) => [
          ...previous.filter((failed) => failed.environmentId !== environmentId),
          ...(result._tag === "Failure"
            ? [{ environmentId, label: presentation.entry.target.label }]
            : []),
        ]);
      }),
    ).finally(() => setNow(Date.now()));
  };
  // Always toggles `refreshing`, even with nothing to probe: Android's
  // RefreshControl keeps its spinner up until it sees true then false.
  const refreshManually = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    await refresh().finally(() => {
      refreshingRef.current = false;
      setRefreshing(false);
    });
  };
  const connectedLimitsEnvironments = [...presentations]
    .flatMap(([environmentId, presentation]) =>
      presentation.connection.phase === "connected" &&
      (selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId))
        ? [environmentId]
        : [],
    )
    .sort()
    .join(",");
  const autoRefreshLimits = useEffectEvent(() => refresh(true));
  useEffect(() => {
    if (active && connectedLimitsEnvironments) void autoRefreshLimits();
  }, [active, connectedLimitsEnvironments]);

  const failedLabels = failedEnvironments
    .filter(
      ({ environmentId }) =>
        selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId),
    )
    .map(({ label }) => label);
  return {
    now,
    refreshing,
    failedLabels,
    refresh: refreshManually,
    refreshAfterEnable: () => refresh(false, true),
  };
}
