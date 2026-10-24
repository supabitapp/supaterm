const DESKTOP_RUNTIME_EXTERNAL_PREFIXES = [
  "@napi-rs/keyring",
  "@crowecawcaw/xa11y",
  "ffi-rs",
  "@yuuang/",
  "node-hid",

  "playwright-core",
] as const;

export const DESKTOP_RUNTIME_FILE_EXCLUSIONS = [
  "!**/node_modules/@cursor/sdk/dist/{esm,bundled}/**/*",
] as const;

export function isDesktopRuntimeExternalDependency(id: string): boolean {
  return DESKTOP_RUNTIME_EXTERNAL_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export function selectDesktopRuntimeExternalDependencies(
  dependencies: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([name]) => isDesktopRuntimeExternalDependency(name)),
  );
}
