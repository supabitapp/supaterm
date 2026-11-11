import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const userDataPath = (input: {
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
  readonly path: Path.Path;
}) => input.path.join(input.appDataDirectory, input.isDevelopment ? "supaterm-dev" : "supaterm-v2");

const GPU_CACHE_DIRECTORIES = [
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
];

// Keyed on Electron, not Chromium: Electron patches ship Chromium backports under the same Chrome version.
export const clearStaleGpuCaches = Effect.fn("desktop.userData.clearStaleGpuCaches")(
  function* (input: { readonly userDataPath: string; readonly electronVersion: string }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const markerPath = path.join(input.userDataPath, "gpu-cache-electron-version");
    const cachedVersion = yield* fs.readFileString(markerPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.undefined,
      ),
    );
    if (cachedVersion?.trim() === input.electronVersion) return;
    for (const name of GPU_CACHE_DIRECTORIES) {
      yield* fs.remove(path.join(input.userDataPath, name), { recursive: true, force: true });
    }
    yield* fs.makeDirectory(input.userDataPath, { recursive: true });
    yield* fs.writeFileString(markerPath, input.electronVersion);
  },
  (effect, input) =>
    effect.pipe(
      Effect.catch((error) =>
        Effect.logWarning("could not clear stale GPU caches", {
          userDataPath: input.userDataPath,
          electronVersion: input.electronVersion,
          error: error.message,
        }),
      ),
    ),
);
