/**
 * Web files the React Compiler must compile, relative to the repository root. Add a
 * file once it compiles cleanly. The root lint config makes the compiler's bailout
 * rules errors for these files, and src/reactCompiledFiles.test.ts compiles each one
 * to catch the bailouts lint cannot see.
 */
export const REACT_COMPILED_FILES = [
  "apps/web/src/components/ui/tooltip.tsx",
  "apps/web/src/hooks/useLiveRefresh.ts",
  "apps/web/src/panelAnimations.ts",
] as const;
