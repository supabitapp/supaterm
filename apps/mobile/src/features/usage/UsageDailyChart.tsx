import type { UsageProviderKind } from "@supaterm/contracts";
import type { DailyTotals } from "@supaterm/shared/usageMerge";
import { formatTokens, formatUsd } from "@supaterm/shared/usageFormat";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { CartesianChart, StackedBar, useChartPressState } from "victory-native";

import { AppText as Text } from "../../components/ui/AppText";
import { buildChartDays, type UsageChartDay, type UsageChartMetric } from "./usageChartData";
import { PROVIDER_LABEL, PROVIDER_ORDER, useProviderColors } from "./usageProviders";

const SERIES = [...PROVIDER_ORDER];
const PRESS_STATE = {
  x: 0,
  y: Object.fromEntries(SERIES.map((provider) => [provider, 0])) as Record<
    UsageProviderKind,
    number
  >,
};
const TOP_CORNERS = { roundedCorners: { topLeft: 2, topRight: 2 } };
const HIDDEN_Y_AXIS = [{ lineWidth: 0 }];

export interface UsageDailyChartProps {
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly metric: UsageChartMetric;
  readonly height: number;
  readonly formatPeriod: (period: string) => string;
}

export function UsageDailyChart({
  days,
  daily,
  metric,
  height,
  formatPeriod,
}: UsageDailyChartProps) {
  const colors = useProviderColors();
  const { state } = useChartPressState(PRESS_STATE);
  const [selected, setSelected] = useState<number | null>(null);
  const select = (index: number) => {
    setSelected(index < 0 ? null : index);
    if (index >= 0) void Haptics.selectionAsync();
  };
  useAnimatedReaction(
    () => (state.isActive.value ? state.matchedIndex.value : -1),
    (index, previous) => {
      if (index !== previous) runOnJS(select)(index);
    },
  );
  // victory-native resets its press state whenever `data` changes identity.
  const chartDays = useMemo(() => buildChartDays(days, daily, metric), [days, daily, metric]);
  const data = useMemo(
    () =>
      chartDays.map((day, index) => ({
        index,
        ...(Object.fromEntries(day.values.map((entry) => [entry.provider, entry.value])) as Record<
          UsageProviderKind,
          number
        >),
      })),
    [chartDays],
  );
  const peak = chartDays.reduce<UsageChartDay | undefined>(
    (best, day) => (best === undefined || day.total > best.total ? day : best),
    undefined,
  );
  const max = peak?.total ?? 0;
  const selectedDay = selected === null ? undefined : chartDays[selected];
  const format = metric === "cost" ? formatUsd : formatTokens;

  return (
    <View
      style={{ height }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        peak === undefined ? undefined : `Highest ${formatPeriod(peak.day)}, ${format(peak.total)}`
      }
    >
      <CartesianChart
        data={data}
        xKey="index"
        yKeys={SERIES}
        domain={{ x: [-0.5, data.length - 0.5], y: [0, max === 0 ? 1 : max] }}
        yAxis={HIDDEN_Y_AXIS}
        chartPressState={state}
      >
        {({ points, chartBounds }) => (
          <StackedBar
            points={SERIES.map((provider) => points[provider])}
            chartBounds={chartBounds}
            colors={SERIES.map((provider) => colors[provider])}
            innerPadding={0.12}
            barOptions={({ isTop, datumIndex }) => ({
              ...(isTop ? TOP_CORNERS : {}),
              opacity: selected === null || selected === datumIndex ? 1 : 0.35,
            })}
          />
        )}
      </CartesianChart>
      {selected === null || selectedDay === undefined ? null : (
        <View
          pointerEvents="none"
          className="absolute top-0 min-w-36 gap-0.5 rounded-xl border border-border bg-card px-2.5 py-2"
          style={selected < data.length / 2 ? { right: 0 } : { left: 0 }}
        >
          <Text className="text-xs text-foreground-muted">{formatPeriod(selectedDay.day)}</Text>
          {selectedDay.values
            .filter((entry) => entry.value > 0)
            .map((entry) => (
              <View key={entry.provider} className="flex-row items-center justify-between gap-3">
                <View className="flex-row items-center gap-1.5">
                  <View
                    className="size-2 rounded-full"
                    style={{ backgroundColor: colors[entry.provider] }}
                  />
                  <Text className="text-xs text-foreground-muted">
                    {PROVIDER_LABEL[entry.provider]}
                  </Text>
                </View>
                <Text className="text-xs tabular-nums text-foreground">{format(entry.value)}</Text>
              </View>
            ))}
          <View className="mt-0.5 flex-row items-center justify-between gap-3 border-t border-border pt-1">
            <Text className="text-xs text-foreground-muted">Total</Text>
            <Text className="text-xs font-supaterm-medium tabular-nums text-foreground">
              {format(selectedDay.total)}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
