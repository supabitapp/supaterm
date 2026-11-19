function formatScaled(value: number) {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2);
}

export function formatBytes(value: number) {
  if (Math.round(value) < 1_024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let next = value / 1_024;
  let unitIndex = 0;
  while (Number(formatScaled(next)) >= 1_024 && unitIndex < units.length - 1) {
    next /= 1_024;
    unitIndex += 1;
  }
  return `${formatScaled(next)} ${units[unitIndex]}`;
}
