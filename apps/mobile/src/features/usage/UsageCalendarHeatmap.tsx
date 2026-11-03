import {
  buildUsageCalendar,
  formatDayShort,
  formatTokens,
  formatUsd,
} from "@supaterm/shared/usageFormat";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import type { UsageChartDay, UsageChartMetric } from "./usageChartData";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LABELED_WEEKDAYS = new Set(["Mon", "Wed", "Fri"]);
const LEVEL_ALPHA = [0.08, 0.25, 0.45, 0.7, 0.95];

export function UsageCalendarHeatmap({
  chartDays,
  metric,
  selectedDay,
  onSelectDay,
}: {
  readonly chartDays: readonly UsageChartDay[];
  readonly metric: UsageChartMetric;
  readonly selectedDay: string | null;
  readonly onSelectDay: (day: string | null) => void;
}) {
  const { themeAppearance } = useAppearancePreferences();
  const ink = themeAppearance === "dark" ? "230, 230, 230" : "60, 60, 67";
  const days = chartDays.map((day) => day.day);
  const totals = chartDays.map((day) => day.total);
  const calendar = buildUsageCalendar(days, totals);
  const lastIndex = days.length - 1;
  const format = metric === "cost" ? formatUsd : formatTokens;
  const { peak } = calendar;

  return (
    <View
      className="gap-1"
      accessibilityLabel={
        peak === null
          ? "No activity in this window"
          : `Highest ${formatDayShort(peak.day)}, ${format(peak.value)}`
      }
    >
      <View className="flex-row gap-1 pl-7">
        {calendar.weeks.map((week, column) => (
          <View
            key={week.find((cell) => cell !== null)?.day}
            className="h-4 flex-1 overflow-visible"
          >
            <Text className="absolute left-0 w-10 text-xs text-foreground-tertiary">
              {calendar.months.find((month) => month.week === column)?.label ?? ""}
            </Text>
          </View>
        ))}
      </View>
      {WEEKDAYS.map((weekday, slot) => (
        <View key={weekday} className="flex-row items-center gap-1">
          <Text className="w-6 text-[9px] text-foreground-tertiary">
            {LABELED_WEEKDAYS.has(weekday) ? weekday : ""}
          </Text>
          {calendar.weeks.map((week) => {
            const key = week.find((cell) => cell !== null)?.day;
            const cell = week[slot];
            if (cell == null) return <View key={key} className="aspect-square flex-1" />;
            const isSelected = cell.day === selectedDay;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${formatDayShort(cell.day)}${cell.index === lastIndex ? " so far" : ""}, ${format(cell.value)}`}
                accessibilityState={{ selected: isSelected }}
                className="aspect-square flex-1 rounded"
                style={{
                  backgroundColor: `rgba(${ink}, ${LEVEL_ALPHA[cell.level]})`,
                  borderWidth: isSelected ? 2 : cell.index === lastIndex ? 1 : 0,
                  borderColor: `rgba(${ink}, ${isSelected ? 1 : 0.5})`,
                }}
                onPress={() => {
                  const next = isSelected ? null : cell.day;
                  onSelectDay(next);
                  if (next !== null) void Haptics.selectionAsync();
                }}
              />
            );
          })}
        </View>
      ))}
      <View className="mt-1 flex-row items-center gap-1">
        <Text className="mr-1 text-xs text-foreground-tertiary">Less</Text>
        {LEVEL_ALPHA.map((alpha) => (
          <View
            key={alpha}
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: `rgba(${ink}, ${alpha})` }}
          />
        ))}
        <Text className="ml-1 text-xs text-foreground-tertiary">More</Text>
      </View>
    </View>
  );
}
