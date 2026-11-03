import { formatTokens, formatUsd } from "@supaterm/shared/usageFormat";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { runOnJS, useSharedValue } from "react-native-reanimated";
import Svg, { Line } from "react-native-svg";

import type { UsageChartDay, UsageChartMetric } from "./usageChartData";
import { PROVIDER_LABEL, useProviderColors } from "./usageProviders";

export const AVERAGE_LINE_COLOR = "rgba(142, 142, 147, 0.9)";
const HOLD_DELAY_MS = 100;
const ADJUST_ACTIONS = [{ name: "increment" }, { name: "decrement" }];

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
  const [width, setWidth] = useState(0);
  const activeIndex = useSharedValue(-1);
  const count = chartDays.length;
  const select = (index: number) => {
    const day = index < 0 ? null : (chartDays[index]?.day ?? null);
    onSelectDay(day);
    if (day !== null) void Haptics.selectionAsync();
  };
  const track = (x: number) => {
    "worklet";
    if (width === 0 || count === 0) return;
    const index = Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
    if (index === activeIndex.get()) return;
    activeIndex.set(index);
    runOnJS(select)(index);
  };
  const gesture = usePanGesture({
    activateAfterLongPress: HOLD_DELAY_MS,
    onActivate: (event) => track(event.x),
    onUpdate: (event) => track(event.x),
    onFinalize: () => {
      if (activeIndex.get() === -1) return;
      activeIndex.set(-1);
      runOnJS(select)(-1);
    },
  });

  const peak = chartDays.reduce<UsageChartDay | undefined>(
    (best, day) => (best === undefined || day.total > best.total ? day : best),
    undefined,
  );
  const max = peak?.total ?? 0;
  const selected = chartDays.findIndex((day) => day.day === selectedDay);
  const partialIndex = lastInProgress ? chartDays.length - 1 : -1;
  const format = metric === "cost" ? formatUsd : formatTokens;
  const scale = (value: number) => (max === 0 ? 0 : (value / max) * height);
  const opacityFor = (index: number) => {
    if (selected >= 0) return selected === index ? 1 : 0.35;
    return index === partialIndex ? 0.45 : 1;
  };
  const selectedPeriod = chartDays[selected];
  const adjust = (actionName: string) => {
    if (count === 0) return;
    const step = actionName === "increment" ? 1 : -1;
    select(selected < 0 ? count - 1 : Math.min(count - 1, Math.max(0, selected + step)));
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={{ height }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={[
          peak === undefined
            ? undefined
            : `Highest ${formatPeriod(peak.day)}, ${format(peak.total)}`,
          average > 0 ? `average ${format(average)}` : undefined,
        ]
          .filter(Boolean)
          .join(", ")}
        accessibilityValue={
          selectedPeriod === undefined
            ? undefined
            : {
                text: [
                  formatPeriod(selectedPeriod.day),
                  format(selectedPeriod.total),
                  ...selectedPeriod.values
                    .filter((entry) => entry.value > 0)
                    .map((entry) => `${PROVIDER_LABEL[entry.provider]} ${format(entry.value)}`),
                ].join(", "),
              }
        }
        accessibilityActions={ADJUST_ACTIONS}
        onAccessibilityAction={(event) => adjust(event.nativeEvent.actionName)}
      >
        <View className="flex-1 flex-row items-end gap-px">
          {/* Use column-reverse: provider values are bottom-first and Hermes lacks toReversed. */}
          {chartDays.map((day, index) => (
            <View
              key={day.day}
              style={{ height: scale(day.total), opacity: opacityFor(index) }}
              className="flex-1 flex-col-reverse gap-px overflow-hidden rounded-t-sm"
            >
              {day.values
                .filter((entry) => entry.value > 0)
                .map((entry) => (
                  <View
                    key={entry.provider}
                    style={{ height: scale(entry.value), backgroundColor: colors[entry.provider] }}
                  />
                ))}
            </View>
          ))}
        </View>
        {average > 0 && max > 0 ? (
          <Svg
            pointerEvents="none"
            width="100%"
            height={1}
            style={{ position: "absolute", left: 0, right: 0, top: height - scale(average) }}
          >
            <Line
              x1="0"
              y1="0.5"
              x2="100%"
              y2="0.5"
              stroke={AVERAGE_LINE_COLOR}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          </Svg>
        ) : null}
      </View>
    </GestureDetector>
  );
}
