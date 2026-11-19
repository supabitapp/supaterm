export type MobileStageLabel = "Dev" | "Nightly" | null;

export function resolveMobileStageLabel(appVariant: unknown) {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  return null;
}
