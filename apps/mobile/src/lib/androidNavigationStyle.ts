export type AndroidNavigationStyle = "one-ui" | "material";

export function resolveAndroidNavigationStyle(
  preference: AndroidNavigationStyle | undefined,
): AndroidNavigationStyle {
  return preference ?? "material";
}
