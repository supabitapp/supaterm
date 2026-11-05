import type { DailyTotals, MergedUsage } from "@supaterm/shared/usageMerge";
import {
  formatCount,
  formatDayShort,
  formatHourShort,
  formatTokens,
  formatUsd,
  periodAverage,
} from "@supaterm/shared/usageFormat";
import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Line as SvgLine } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { UsageCalendarHeatmap } from "./UsageCalendarHeatmap";
import { AVERAGE_LINE_COLOR, UsageDailyChart } from "./UsageDailyChart";
import { buildChartDays, type UsageChartDay, type UsageChartMetric } from "./usageChartData";
import { PROVIDER_LABEL, useProviderColors } from "./usageProviders";

const CALENDAR_MIN_DAYS = 32;

export function UsageChartCard(props: {
  readonly merged: MergedUsage;
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly metric: UsageChartMetric;
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly isPast24Hours: boolean;
  readonly timeZone: string;
  readonly height: number;
  /** Replaces the summary when it sits beside the chart. */
  readonly title?: string;
  /** Grows the chart past `height` to match a taller neighbouring column. */
  readonly fill?: boolean;
}) {
  const { merged, metric, isPast24Hours } = props;
  const colors = useProviderColors();
  const [fillHeight, setFillHeight] = useState(0);
  const [picked, setPicked] = useState<{ readonly day: string; readonly window: string } | null>(
    null,
  );
  const chartDays = useMemo(
    () => buildChartDays(props.days, props.daily, metric),
    [props.days, props.daily, metric],
  );
  const hasActivity = props.daily.some((period) => period.totalTokens > 0);
  const windowKey = `${props.sinceDay}/${props.untilDay}/${isPast24Hours}`;
  const selectedDay = hasActivity && picked?.window === windowKey ? picked.day : null;
  const selectDay = (day: string | null) =>
    setPicked(day === null ? null : { day, window: windowKey });
  const height = props.fill ? Math.max(fillHeight, props.height) : props.height;
  const showCalendar = !isPast24Hours && chartDays.length >= CALENDAR_MIN_DAYS;
  const average = periodAverage(
    chartDays.map((period) => period.total),
    !isPast24Hours,
  );
  const format = metric === "cost" ? formatUsd : formatTokens;
  const formatPeriod = (period: string) =>
    isPast24Hours ? formatHourShort(period, props.timeZone) : formatDayShort(period);
  const selection = chartDays.find((period) => period.day === selectedDay);
  const lastDay = chartDays[chartDays.length - 1]?.day;

  const chart = !hasActivity ? (
    <View style={{ height }} className="items-center justify-center">
      <Text className="text-base text-foreground-muted">No activity in this window.</Text>
    </View>
  ) : showCalendar ? (
    <UsageCalendarHeatmap
      chartDays={chartDays}
      metric={metric}
      selectedDay={selectedDay}
      onSelectDay={selectDay}
    />
  ) : (
    <UsageDailyChart
      chartDays={chartDays}
      metric={metric}
      height={height}
      average={average}
      lastInProgress={!isPast24Hours}
      selectedDay={selectedDay}
      onSelectDay={selectDay}
      formatPeriod={formatPeriod}
    />
  );
  const header =
    selection !== undefined ? (
      <SelectionSummary
        period={selection}
        label={`${formatPeriod(selection.day)}${!isPast24Hours && selection.day === lastDay ? " so far" : ""}`}
        format={format}
        compact={props.title !== undefined}
      />
    ) : props.title ? (
      <Text className="text-sm font-supaterm-medium text-foreground">{props.title}</Text>
    ) : (
      <UsageSummary merged={merged} metric={metric} />
    );

  return (
    <View
      className={`gap-4 rounded-[24px] border-continuous bg-grouped-card p-4${props.fill ? " flex-1" : ""}`}
    >
      {header}

      {props.fill && !showCalendar ? (
        // Absolute so the measured slot can shrink again when the neighbour gets shorter.
        <View
          className="flex-1"
          style={{ minHeight: props.height }}
          onLayout={(event) => setFillHeight(event.nativeEvent.layout.height)}
        >
          <View className="absolute inset-0">{chart}</View>
        </View>
      ) : (
        chart
      )}

      {showCalendar ? null : (
        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs text-foreground-tertiary">
              {isPast24Hours
                ? formatHourShort(props.days[0] ?? "", props.timeZone)
                : formatDayShort(props.sinceDay)}
            </Text>
            {average > 0 ? (
              <View className="flex-row items-center gap-1.5">
                <Svg width={12} height={2}>
                  <SvgLine
                    x1={0}
                    y1={1}
                    x2={12}
                    y2={1}
                    stroke={AVERAGE_LINE_COLOR}
                    strokeWidth={1}
                    strokeDasharray="3 2"
                  />
                </Svg>
                <Text className="text-xs text-foreground-tertiary tabular-nums">
                  avg {format(average)}
                </Text>
              </View>
            ) : null}
            <Text className="text-xs text-foreground-tertiary">
              {isPast24Hours
                ? formatHourShort(props.days[props.days.length - 1] ?? "", props.timeZone)
                : formatDayShort(props.untilDay)}
            </Text>
          </View>
          <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
            {merged.providers.map((provider) => (
              <View key={provider.provider} className="flex-row items-center gap-1.5">
                <View
                  className="size-2 rounded-full"
                  style={{ backgroundColor: colors[provider.provider] }}
                />
                <Text className="text-xs text-foreground-muted">
                  {PROVIDER_LABEL[provider.provider]}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function SelectionSummary(props: {
  readonly period: UsageChartDay;
  readonly label: string;
  readonly format: (value: number) => string;
  readonly compact: boolean;
}) {
  const { format } = props;
  const split = props.period.values
    .filter((entry) => entry.value > 0)
    .map((entry) => `${PROVIDER_LABEL[entry.provider]} ${format(entry.value)}`)
    .join(" · ");
  if (props.compact) {
    return (
      <Text numberOfLines={1} className="text-sm font-supaterm-medium text-foreground tabular-nums">
        {[props.label, format(props.period.total), split].filter(Boolean).join(" · ")}
      </Text>
    );
  }
  return (
    <View className="gap-0.5">
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <Text className="text-4xl font-supaterm-bold tabular-nums text-foreground">
        {format(props.period.total)}
      </Text>
      <Text numberOfLines={1} className="text-sm text-foreground-muted tabular-nums">
        {split || "No activity"}
      </Text>
    </View>
  );
}

export function UsageSummary(props: {
  readonly merged: MergedUsage;
  readonly metric: UsageChartMetric;
}) {
  const { merged, metric } = props;
  return (
    <View className="gap-0.5">
      <Text className="text-sm text-foreground-muted">
        {metric === "cost" ? "Raw token cost" : "Processed tokens"}
      </Text>
      <Text className="text-4xl font-supaterm-bold tabular-nums text-foreground">
        {metric === "cost" ? `${formatUsd(merged.costUsd)}*` : formatTokens(merged.totalTokens)}
      </Text>
      <Text className="text-sm text-foreground-muted">
        {metric === "cost"
          ? "* if billed at full API rate"
          : `Across ${formatCount(merged.sessions)} ${merged.sessions === 1 ? "session" : "sessions"}`}
      </Text>
    </View>
  );
}
