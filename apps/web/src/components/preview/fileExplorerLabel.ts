import type { ExecutionEnvironmentPlatformOs, FileManagerRevealKind } from "@supaterm/contracts";

export function revealInFileExplorerLabel(platform: string) {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) return "Reveal in Finder";
  if (normalized.includes("win")) return "Reveal in File Explorer";
  return "Reveal in Files";
}

export function revealInFileExplorerLabelForOs(os: ExecutionEnvironmentPlatformOs) {
  if (os === "darwin") return "Reveal in Finder";
  if (os === "windows") return "Reveal in File Explorer";
  return "Reveal in Files";
}

export function revealInFileExplorerLabelForKind(kind: FileManagerRevealKind) {
  if (kind === "finder") return "Reveal in Finder";
  if (kind === "file-explorer") return "Reveal in File Explorer";
  return "Reveal in Files";
}
