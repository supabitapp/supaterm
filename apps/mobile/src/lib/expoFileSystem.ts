export function loadExpoFileSystem(): Promise<typeof import("expo-file-system")>;
export async function loadExpoFileSystem() {
  if (process.env.NODE_ENV === "test")
    return import("expo-file-system") satisfies typeof import("expo-file-system");
  return require("expo-file-system") satisfies typeof import("expo-file-system");
}
