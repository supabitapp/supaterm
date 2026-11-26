import type { ExecutionEnvironmentPlatformOs, FileManagerRevealKind } from "@supaterm/contracts";
import { msg } from "gt-react";

export function revealInFileExplorerLabel(platform: string): string {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) return msg("Reveal in Finder");
  if (normalized.includes("win")) return msg("Reveal in File Explorer");
  return msg("Reveal in Files");
}

export function revealInFileExplorerLabelForOs(os: ExecutionEnvironmentPlatformOs): string {
  if (os === "darwin") return msg("Reveal in Finder");
  if (os === "windows") return msg("Reveal in File Explorer");
  return msg("Reveal in Files");
}

export function revealInFileExplorerLabelForKind(kind: FileManagerRevealKind): string {
  if (kind === "finder") return msg("Reveal in Finder");
  if (kind === "file-explorer") return msg("Reveal in File Explorer");
  return msg("Reveal in Files");
}
