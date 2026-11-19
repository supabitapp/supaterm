import { isWindowsAbsolutePath } from "@supaterm/shared/path";

export function formatFilePathForClipboard(path: string, hostPath = path) {
  return isWindowsAbsolutePath(hostPath) ? path.replaceAll("/", "\\") : path;
}

export type MediaActionId =
  | "copy-full-path"
  | "copy-relative-path"
  | "copy-url"
  | "open-file"
  | "save"
  | "save-image"
  | "copy-image";
