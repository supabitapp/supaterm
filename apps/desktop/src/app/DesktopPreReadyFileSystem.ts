// @effect-diagnostics nodeBuiltinImport:off -- Effect's Node FileSystem is async, and pre-ready startup must finish before Chromium opens its caches.
import * as NodeFS from "node:fs";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";

const systemErrorTag = (cause: unknown) => {
  switch ((cause as NodeJS.ErrnoException | undefined)?.code) {
    case "EEXIST":
      return "AlreadyExists";
    case "ENOENT":
      return "NotFound";
    case "EACCES":
    case "EPERM":
      return "PermissionDenied";
    default:
      return "Unknown";
  }
};

const syncFs = <A>(method: string, path: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) =>
      PlatformError.systemError({
        _tag: systemErrorTag(cause),
        module: "FileSystem",
        method,
        pathOrDescriptor: path,
        cause,
      }),
  });

export const make = FileSystem.makeNoop({
  readFileString: (path) => syncFs("readFileString", path, () => NodeFS.readFileSync(path, "utf8")),
  makeDirectory: (path, options) =>
    syncFs("makeDirectory", path, () => {
      NodeFS.mkdirSync(path, { recursive: options?.recursive ?? false });
    }),
  remove: (path, options) =>
    syncFs("remove", path, () =>
      NodeFS.rmSync(path, {
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
      }),
    ),
  writeFileString: (path, data, options) =>
    syncFs("writeFileString", path, () =>
      NodeFS.writeFileSync(path, data, { flag: options?.flag ?? "w" }),
    ),
});
