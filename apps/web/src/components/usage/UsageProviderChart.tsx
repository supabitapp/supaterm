import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import type { UsageProviderKind } from "@supaterm/contracts";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  type AxisDomainItem,
  type TooltipIndex,
} from "recharts";

import type { DailyTotals, HourlyTotals } from "@supaterm/shared/usageMerge";
import {
  formatDayShort,
  formatHourShort,
  formatRelativeHourShort,
  formatTokens,
  formatUsd,
} from "@supaterm/shared/usageFormat";
import { cn } from "~/lib/utils";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "./usageProviders";

const TICK_COUNT = 5;
const PLACEHOLDER_DOMAIN: Readonly<[AxisDomainItem, AxisDomainItem]> = [0, TICK_COUNT - 1];
const VALUE_DOMAIN: Readonly<[AxisDomainItem, AxisDomainItem]> = [0, "auto"];
const AXIS_TICK = { fill: "var(--color-muted-foreground)", fontSize: 10 };
const NONE_LOADING: ReadonlySet<UsageProviderKind> = new Set();

export type UsageChartMetric = "tokens" | "cost";

interface UsageProviderChartProps {
  readonly providers: readonly UsageProviderKind[];
  readonly loadingProviders?: ReadonlySet<UsageProviderKind>;
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly hours: readonly string[];
  readonly hourly: readonly HourlyTotals[];
  readonly metric: UsageChartMetric;
  readonly referenceTime: string | undefined;
  readonly resolution: "day" | "hour";
  readonly timeZone: string;
  readonly hour12: boolean;
}

export interface DayColumn {
  readonly bands: readonly {
    readonly provider: UsageProviderKind;
    readonly value: number;
  }[];
  readonly total: number;
}

function valueFor(
  totals: DailyTotals | HourlyTotals | undefined,
  provider: UsageProviderKind,
  metric: UsageChartMetric,
): number {
  const entry = totals?.byProvider.get(provider);
  if (entry === undefined) return 0;
  return metric === "tokens" ? entry.totalTokens : entry.costUsd;
}

export function buildPeriodColumns(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
): readonly DayColumn[] {
  return periods.map((period) => {
    const entry = byPeriod.get(period);
    const bands = PROVIDER_ORDER.map((provider) => ({
      provider,
      value: valueFor(entry, provider, metric),
    }));
    return { bands, total: bands.reduce((sum, band) => sum + band.value, 0) };
  });
}

function UsageChartTooltip({
  active,
  activeIndex,
  columns,
  periods,
  providers,
  loadingProviders,
  format,
  formatPeriod,
}: {
  readonly active?: boolean;
  readonly activeIndex?: TooltipIndex | undefined;
  readonly columns: readonly DayColumn[];
  readonly periods: readonly string[];
  readonly providers: readonly UsageProviderKind[];
  readonly loadingProviders: ReadonlySet<UsageProviderKind>;
  readonly format: (value: number) => string;
  readonly formatPeriod: (period: string) => string;
}) {
  const index = Number(activeIndex ?? -1);
  const column = columns[index];
  const period = periods[index];
  if (!active || column === undefined || period === undefined) return null;
  const partial = providers.some((provider) => loadingProviders.has(provider));
  return (
    <div className="surface-glass min-w-36 rounded-xl border border-border/50 px-2.5 py-2 text-xs shadow-lg">
      <div className="mb-1 text-muted-foreground">{formatPeriod(period)}</div>
      {providers.map((provider) => {
        const { label: providerLabel, driverKind } = PROVIDER_PRESENTATION[provider];
        return (
          <div key={provider} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ProviderInstanceIcon
                driverKind={driverKind}
                displayName={providerLabel}
                iconClassName="size-3"
              />
              {providerLabel}
            </span>
            <span
              className={cn(
                "tabular-nums",
                loadingProviders.has(provider) ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {format(column.bands.find((band) => band.provider === provider)?.value ?? 0)}
            </span>
          </div>
        );
      })}
      <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1">
        <span className="text-muted-foreground">Total</span>
        <span className={cn("tabular-nums", partial ? "text-muted-foreground" : "text-foreground")}>
          {format(column.total)}
        </span>
      </div>
    </div>
  );
}

export function UsageProviderChart({
  providers,
  loadingProviders = NONE_LOADING,
  days,
  daily,
  hours,
  hourly,
  metric,
  referenceTime,
  resolution,
  timeZone,
  hour12,
}: UsageProviderChartProps) {
  const periods = resolution === "hour" ? hours : days;
  const totals: readonly (DailyTotals | HourlyTotals)[] = resolution === "hour" ? hourly : daily;
  const byPeriod = new Map(
    totals.map((entry) => ["hourStart" in entry ? entry.hourStart : entry.day, entry]),
  );
  const columns = buildPeriodColumns(periods, byPeriod, metric);
  const data = columns.map((column, index) => ({
    period: periods[index] ?? "",
    ...Object.fromEntries(column.bands.map((band) => [band.provider, band.value])),
  }));
  const seriesTotal = (provider: UsageProviderKind) =>
    columns.reduce(
      (sum, column) => sum + (column.bands.find((band) => band.provider === provider)?.value ?? 0),
      0,
    );
  const series = providers.toSorted((a, b) => seriesTotal(b) - seriesTotal(a));
  const placeholder = loadingProviders.size > 0 && columns.every((column) => column.total === 0);

  const format = metric === "tokens" ? formatTokens : formatUsd;
  const formatPeriod = (period: string) =>
    resolution === "hour" ? formatHourShort(period, timeZone, hour12) : formatDayShort(period);
  const formatTooltipPeriod = (period: string) =>
    resolution === "hour" && referenceTime !== undefined
      ? formatRelativeHourShort(period, referenceTime, timeZone, hour12)
      : formatPeriod(period);

  return (
    <div className="h-64">
      <AreaChart
        responsive
        style={{ width: "100%", height: "100%" }}
        data={data}
        margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
        aria-label={`${resolution === "hour" ? "Hourly" : "Daily"} ${metric === "tokens" ? "processed tokens" : "cost"} by provider`}
      >
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          dataKey="period"
          axisLine={false}
          tickLine={false}
          tick={AXIS_TICK}
          tickFormatter={(period: string) => formatPeriod(period).toUpperCase()}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          width={56}
          axisLine={false}
          tickLine={false}
          tick={placeholder ? false : AXIS_TICK}
          tickCount={TICK_COUNT}
          domain={placeholder ? PLACEHOLDER_DOMAIN : VALUE_DOMAIN}
          tickFormatter={(value: number) => (value === 0 ? "0" : format(value))}
        />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: "var(--color-muted-foreground)", strokeWidth: 1 }}
          content={
            <UsageChartTooltip
              columns={columns}
              periods={periods}
              providers={providers}
              loadingProviders={loadingProviders}
              format={format}
              formatPeriod={formatTooltipPeriod}
            />
          }
        />
        {series.map((provider) => (
          <Area
            key={provider}
            dataKey={provider}
            type="monotone"
            className={cn(
              "transition-opacity",
              loadingProviders.has(provider) && "opacity-40 delay-150",
            )}
            stroke={PROVIDER_PRESENTATION[provider].color}
            strokeWidth={2}
            fill={PROVIDER_PRESENTATION[provider].color}
            fillOpacity={0.12}
            activeDot={{ r: 3.5, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </div>
  );
}
