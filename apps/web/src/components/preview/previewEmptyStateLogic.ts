import type { ProjectScript } from "@supaterm/contracts";

export function getConfiguredPreviewUrls(scripts: ReadonlyArray<ProjectScript> | undefined) {
  return scripts?.flatMap((script) => (script.previewUrl ? [script.previewUrl] : [])) ?? [];
}
