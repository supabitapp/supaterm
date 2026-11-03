import type { UsageProviderKind } from "@supaterm/contracts";
import type { DailyTotals } from "@supaterm/shared/usageMerge";
import { completedPeriodAverage, formatTokens, formatUsd } from "@supaterm/shared/usageFormat";
import { DashPathEffect, Line, vec } from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import { useMemo } from "react";
import { View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { CartesianChart, StackedBar, useChartPressState } from "victory-native";

import { buildChartDays, type UsageChartDay, type UsageChartMetric } from "./usageChartData";
import { PROVIDER_ORDER, useProviderColors } from "./usageProviders";

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
export const AVERAGE_LINE_COLOR = "rgba(142, 142, 147, 0.9)";

export interface UsageDailyChartProps {
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly metric: UsageChartMetric;
  readonly height: number;
  readonly selectedDay: string | null;
  readonly onSelectDay: (day: string | null) => void;
  readonly formatPeriod: (period: string) => string;
}

export function UsageDailyChart({
  days,
  daily,
  metric,
  height,
  selectedDay,
  onSelectDay,
  formatPeriod,
}: UsageDailyChartProps) {
  const colors = useProviderColors();
  const { state } = useChartPressState(PRESS_STATE);
  const select = (index: number) => {
    const day = index < 0 ? null : (days[index] ?? null);
    onSelectDay(day);
    if (day !== null) void Haptics.selectionAsync();
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
  const domainMax = peak === undefined || peak.total === 0 ? 1 : peak.total;
  const average = completedPeriodAverage(chartDays.map((day) => day.total));
  const selected = selectedDay === null ? -1 : days.indexOf(selectedDay);
  const lastIndex = data.length - 1;
  const format = metric === "cost" ? formatUsd : formatTokens;

  return (
    <View
      style={{ height }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={[
        peak === undefined ? undefined : `Highest ${formatPeriod(peak.day)}, ${format(peak.total)}`,
        average > 0 ? `average ${format(average)}` : undefined,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <CartesianChart
        data={data}
        xKey="index"
        yKeys={SERIES}
        domain={{ x: [-0.5, data.length - 0.5], y: [0, domainMax] }}
        yAxis={HIDDEN_Y_AXIS}
        chartPressState={state}
      >
        {({ points, chartBounds, yScale }) => (
          <>
            <StackedBar
              points={SERIES.map((provider) => points[provider])}
              chartBounds={chartBounds}
              colors={SERIES.map((provider) => colors[provider])}
              innerPadding={0.12}
              barOptions={({ isTop, datumIndex }) => ({
                ...(isTop ? TOP_CORNERS : {}),
                opacity:
                  selected >= 0
                    ? selected === datumIndex
                      ? 1
                      : 0.35
                    : datumIndex === lastIndex
                      ? 0.45
                      : 1,
              })}
            />
            {average > 0 ? (
              <Line
                p1={vec(chartBounds.left, yScale(average))}
                p2={vec(chartBounds.right, yScale(average))}
                color={AVERAGE_LINE_COLOR}
                strokeWidth={1}
              >
                <DashPathEffect intervals={[4, 4]} />
              </Line>
            ) : null}
          </>
        )}
      </CartesianChart>
    </View>
  );
}
