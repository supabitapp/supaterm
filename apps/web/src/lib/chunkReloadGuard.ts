const CHUNK_RELOAD_GUARD_KEY = "supaterm:chunk-load-reloaded";

export function reloadOnceForChunkLoadError(
  getStorage: () => Storage = () => window.sessionStorage,
  reload: () => void = () => window.location.reload(),
  build = import.meta.env.APP_VERSION,
) {
  let alreadyReloaded: boolean;
  try {
    const storage = getStorage();
    alreadyReloaded = storage.getItem(CHUNK_RELOAD_GUARD_KEY) === build;
    if (!alreadyReloaded) storage.setItem(CHUNK_RELOAD_GUARD_KEY, build);
  } catch {
    return false;
  }
  if (alreadyReloaded) return false;
  reload();
  return true;
}

const CHUNK_LOAD_ERROR_PREFIXES = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
];

export function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : undefined;
  return (
    message !== undefined && CHUNK_LOAD_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))
  );
}
