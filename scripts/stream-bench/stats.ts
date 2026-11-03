// @effect-diagnostics globalConsole:off - Prints the benchmark's tables.
export const sum = (values: ReadonlyArray<number>) =>
  values.reduce((total, value) => total + value, 0);

export const percentile = (values: ReadonlyArray<number>, p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
};

export const slope = (points: ReadonlyArray<readonly [number, number]>) => {
  if (points.length < 2) return null;
  const meanX = sum(points.map(([x]) => x)) / points.length;
  const meanY = sum(points.map(([, y]) => y)) / points.length;
  const covariance = sum(points.map(([x, y]) => (x - meanX) * (y - meanY)));
  const variance = sum(points.map(([x]) => (x - meanX) ** 2));
  return variance === 0 ? null : covariance / variance;
};

export const round = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));

interface Spread {
  readonly median: number;
  readonly min: number;
  readonly max: number;
}
export type Aggregate<Metrics> = { readonly [Key in keyof Metrics]?: Spread | null };

export const aggregate = <Metrics extends Record<keyof Metrics, number | null>>(
  runs: ReadonlyArray<Metrics>,
): Aggregate<Metrics> => {
  const keys = runs.length > 0 ? (Object.keys(runs[0]!) as Array<keyof Metrics>) : [];
  return Object.fromEntries(
    keys.map((key) => {
      const numbers = runs.flatMap((run) => {
        const value = run[key];
        return typeof value === "number" ? [value] : [];
      });
      return [
        key,
        numbers.length === 0
          ? null
          : {
              median: percentile(numbers, 0.5)!,
              min: Math.min(...numbers),
              max: Math.max(...numbers),
            },
      ];
    }),
  ) as Aggregate<Metrics>;
};

export const median = <Metrics>(stats: Aggregate<Metrics>, key: keyof Metrics) =>
  stats[key]?.median ?? null;
export const spread = <Metrics>(stats: Aggregate<Metrics>, key: keyof Metrics) => {
  const value = stats[key];
  return value ? `${value.median} (${value.min}-${value.max})` : "-";
};

export const table = (rows: ReadonlyArray<Record<string, string | number | null>>) => {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]!);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? "-").length)),
  );
  const line = (texts: ReadonlyArray<string>) =>
    texts.map((text, index) => text.padEnd(widths[index]!)).join("  ");
  console.log(line(columns));
  for (const row of rows) console.log(line(columns.map((column) => String(row[column] ?? "-"))));
  console.log();
};
