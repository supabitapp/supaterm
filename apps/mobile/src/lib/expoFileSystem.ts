export async function loadExpoFileSystem(): Promise<typeof import("expo-file-system")> {
  if (process.env.NODE_ENV === "test") return import("expo-file-system");
  return require("expo-file-system");
}
