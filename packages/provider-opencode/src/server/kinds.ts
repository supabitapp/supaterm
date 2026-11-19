import { ProviderDriverKind, type ProviderRequestKind } from "@supaterm/contracts";

export const OPENCODE_PROVIDER = ProviderDriverKind.make("opencode");

type OpenCodePermissionRequestKind = Extract<
  ProviderRequestKind,
  "command" | "file-read" | "file-change"
>;

export function openCodePermissionRequestKind(
  permission: string,
  toolName?: string,
): OpenCodePermissionRequestKind {
  const normalized = permission.toLowerCase();
  const normalizedTool = toolName?.toLowerCase() ?? "";
  if (
    normalized === "edit" ||
    normalized === "write" ||
    normalized === "patch" ||
    normalized === "apply_patch" ||
    normalizedTool === "edit" ||
    normalizedTool === "write" ||
    normalizedTool === "patch" ||
    normalizedTool === "apply_patch"
  ) {
    return "file-change";
  }
  if (
    normalized === "read" ||
    normalized === "glob" ||
    normalized === "grep" ||
    normalized === "lsp" ||
    normalized === "external_directory" ||
    normalizedTool === "read" ||
    normalizedTool.includes("glob") ||
    normalizedTool.includes("grep") ||
    normalizedTool.includes("search")
  ) {
    return "file-read";
  }
  return "command";
}
