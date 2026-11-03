import type { UsageProviderKind } from "@supaterm/contracts";
import { formatTokens, formatUsd } from "@supaterm/shared/usageFormat";
import { DashPathEffect, Line, vec } from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import { useMemo } from "react";
import { View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { CartesianChart, StackedBar, useChartPressState } from "victory-native";

import type { UsageChartDay, UsageChartMetric } from "./usageChartData";
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
  readonly chartDays: readonly UsageChartDay[];
  readonly metric: UsageChartMetric;
  readonly height: number;
  readonly average: number;
  readonly lastInProgress: boolean;
  readonly selectedDay: string | null;
  readonly onSelectDay: (day: string | null) => void;
  readonly formatPeriod: (period: string) => string;
}

export function UsageDailyChart({
  chartDays,
  metric,
  height,
  average,
  lastInProgress,
  selectedDay,
  onSelectDay,
  formatPeriod,
}: UsageDailyChartProps) {
  const colors = useProviderColors();
  const { state } = useChartPressState(PRESS_STATE);
  const select = (index: number) => {
    const day = index < 0 ? null : (chartDays[index]?.day ?? null);
    onSelectDay(day);
    if (day !== null) void Haptics.selectionAsync();
  };
  useAnimatedReaction(
    () => (state.isActive.value ? state.matchedIndex.value : -1),
    (index, previous) => {
      if (index !== previous) runOnJS(select)(index);
    },
  );
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
  const selected = chartDays.findIndex((day) => day.day === selectedDay);
  const partialIndex = lastInProgress ? data.length - 1 : -1;
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
                    : datumIndex === partialIndex
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
