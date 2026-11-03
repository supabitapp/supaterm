import type { UsageProviderKind } from "@supaterm/contracts";
import { useState } from "react";

import {
  buildUsageCalendar,
  formatDayShort,
  periodAverage,
  type UsageCalendarLevel,
} from "@supaterm/shared/usageFormat";
import { cn } from "~/lib/utils";
import type { DayColumn } from "./UsageProviderChart";
import { PROVIDER_PRESENTATION } from "./usageProviders";

const LEVEL_CLASS: Record<UsageCalendarLevel, string> = {
  0: "bg-muted",
  1: "bg-foreground/20",
  2: "bg-foreground/40",
  3: "bg-foreground/65",
  4: "bg-foreground/90",
};
const CELL_PITCH = 32;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LABELED_WEEKDAYS = new Set(["Mon", "Wed", "Fri"]);

export function UsageCalendarHeatmap({
  days,
  columns,
  providers,
  format,
  ariaLabel,
  loading,
}: {
  readonly days: readonly string[];
  readonly columns: readonly DayColumn[];
  readonly providers: readonly UsageProviderKind[];
  readonly format: (value: number) => string;
  readonly ariaLabel: string;
  readonly loading: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const totals = columns.map((column) => column.total);
  const calendar = buildUsageCalendar(days, totals);
  const average = periodAverage(totals, true);
  const lastIndex = days.length - 1;

  const describe = (index: number) => {
    const column = columns[index];
    const day = days[index];
    if (column === undefined || day === undefined) return "";
    const split = column.bands
      .filter((band) => band.value > 0 && providers.includes(band.provider))
      .map((band) => `${PROVIDER_PRESENTATION[band.provider].label} ${format(band.value)}`);
    return [
      `${formatDayShort(day)}${index === lastIndex ? " so far" : ""}`,
      format(column.total),
      ...split,
    ].join(" · ");
  };
  const { peak } = calendar;
  const emptySummary = loading ? "" : "No activity in this window";
  const summary =
    peak === null
      ? emptySummary
      : [
          `Highest ${formatDayShort(peak.day)}`,
          format(peak.value),
          average > 0 ? `${format(average)} a day on average` : undefined,
        ]
          .filter(Boolean)
          .join(" · ");

  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    setActive((current) => Math.min(lastIndex, Math.max(0, (current ?? lastIndex) + step)));
  };

  return (
    <div
      className={cn("flex flex-col gap-3 transition-opacity", loading && "opacity-40 delay-150")}
    >
      <p aria-live="polite" className="h-4 truncate text-xs text-muted-foreground tabular-nums">
        {active === null ? summary : describe(active)}
      </p>
      <div
        role="group"
        aria-label={`${ariaLabel}. ${summary}`}
        tabIndex={0}
        className="flex w-fit gap-2 rounded-md"
        onKeyDown={move}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
      >
        <div className="grid grid-rows-7 gap-1 pt-5 text-3xs text-muted-foreground">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday} className="flex h-7 items-center">
              {LABELED_WEEKDAYS.has(weekday) ? weekday : ""}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <div className="relative h-4 text-3xs text-muted-foreground uppercase">
            {calendar.months.map((month) => (
              <span
                key={`${month.week}-${month.label}`}
                className="absolute"
                style={{ left: month.week * CELL_PITCH }}
              >
                {month.label}
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            {calendar.weeks.map((week) => (
              <div key={week.find((cell) => cell !== null)?.day} className="grid grid-rows-7 gap-1">
                {WEEKDAYS.map((weekday, slot) => {
                  const cell = week[slot];
                  return cell == null ? (
                    <span key={weekday} className="size-7" />
                  ) : (
                    <span
                      key={weekday}
                      aria-hidden
                      className={cn(
                        "size-7 rounded-sm",
                        LEVEL_CLASS[cell.level],
                        cell.index === lastIndex && "ring-1 ring-foreground/50 ring-inset",
                        cell.index === active && "ring-2 ring-ring",
                      )}
                      onMouseEnter={() => setActive(cell.index)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 text-3xs text-muted-foreground">
        <span className="mr-1">Less</span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span key={level} className={cn("size-3 rounded-xs", LEVEL_CLASS[level])} />
        ))}
        <span className="ml-1">More</span>
      </div>
    </div>
  );
}
