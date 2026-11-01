interface ProductUsageDataTarget {
  readonly label: string;
  readonly serverConfig: {
    readonly environment: { readonly capabilities: { readonly telemetrySetting?: boolean } };
    readonly observability: { readonly telemetryEnabledByEnvironment?: boolean | undefined };
  } | null;
}

/**
 * How the Product usage data switch shows for `targets`, or null when one of their servers
 * ignores the setting and a switch there would claim an opt-out that never happens.
 */
export function resolveProductUsageDataControl(targets: readonly ProductUsageDataTarget[]) {
  if (
    !targets.every(
      (target) => target.serverConfig?.environment.capabilities.telemetrySetting === true,
    )
  ) {
    return null;
  }
  const overrides = targets.flatMap((target) => {
    const value = target.serverConfig?.observability.telemetryEnabledByEnvironment;
    return value === undefined ? [] : [{ label: target.label, value }];
  });
  const forcedValues = new Set(overrides.map(({ value }) => value));
  const [onlyForcedValue] = forcedValues;
  return {
    status:
      overrides.length === 0
        ? undefined
        : overrides
            .map(({ label, value }) => `Set by SUPATERM_TELEMETRY_ENABLED=${value} on ${label}.`)
            .join(" "),
    // Where the variable decides on every target, the saved setting does not decide what shows.
    forced:
      targets.length > 0 && overrides.length === targets.length
        ? { value: forcedValues.size === 1 ? (onlyForcedValue ?? null) : null }
        : null,
  };
}
