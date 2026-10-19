/**
 * Both `apps/desktop/vite.config.ts` and the artifact stage in
 * scripts/build-desktop-artifact.ts derive from this list, so a package that is
 * external is also the only kind of package the staged production install
 * carries.
 */
export const DESKTOP_RUNTIME_EXTERNAL_PREFIXES = [
  // Native addons and the wrappers that dlopen them by real path.
  "@napi-rs/keyring",
  "@crowecawcaw/xa11y",
  "ffi-rs",
  "@yuuang/",
  "node-hid",
  // Desktop injection reads coreBundle.js; the server browser loads the full runtime.
  "playwright-core",
] as const;

export const DESKTOP_RUNTIME_FILE_EXCLUSIONS = [
  // Cursor's createRequire entry uses only CommonJS and its computed chunks.
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
