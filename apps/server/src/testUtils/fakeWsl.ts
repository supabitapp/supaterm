import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const makeFakeWslHost = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const mountRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "supaterm-wsl-mnt-" });
  const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "supaterm-wsl-bin-" });
  const wslpath = path.join(binDir, "wslpath");
  yield* fileSystem
    .writeFileString(
      wslpath,
      [
        "#!/bin/sh",
        '[ "$1" = "-u" ] || exit 1',
        "p=$(printf '%s' \"$2\" | tr '\\\\' '/')",
        "drive=$(printf '%s' \"$p\" | cut -c1 | tr 'A-Z' 'a-z')",
        `printf '%s/%s%s\\n' '${mountRoot}' "$drive" "\${p#?:}"`,
        "",
      ].join("\n"),
    )
    .pipe(Effect.orDie);
  yield* fileSystem.chmod(wslpath, 0o755).pipe(Effect.orDie);
  const environment = {
    ...HostProcess.Environment.defaultValue(),
    PATH: `${binDir}:${HostProcess.Environment.defaultValue().PATH ?? ""}`,
  };
  const underWsl = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, environment),
    );
  return { mountRoot, underWsl };
});
