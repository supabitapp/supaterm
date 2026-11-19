import { writeFileStringAtomically } from "@supaterm/shared/atomicWrite";
import { fromJsonStringPretty, fromLenientJson } from "@supaterm/shared/schemaJson";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import { resolveBaseDir } from "../os-jank.ts";

const SparseSettings = Schema.Record(Schema.String, Schema.Unknown);
const decodeSettingsJson = Schema.decodeUnknownEffect(fromLenientJson(SparseSettings));
const encodeSettingsJson = Schema.encodeEffect(fromJsonStringPretty(SparseSettings));
const CONCURRENT_WRITE_ATTEMPTS = 5;
const DEV_VARIANT_PLACEHOLDER_URL = new URL("http://localhost");

export class SettingsFileUnreadableError extends Schema.TaggedError<SettingsFileUnreadableError>()(
  "SettingsFileUnreadableError",
  { settingsPath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read ${this.settingsPath}. Fix its permissions, then run this again.`;
  }
}

export class SettingsFileMalformedError extends Schema.TaggedError<SettingsFileMalformedError>()(
  "SettingsFileMalformedError",
  { settingsPath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `${this.settingsPath} is not a JSON object. Fix it, then run this again.`;
  }
}

export class SettingsWriteBusyError extends Schema.TaggedError<SettingsWriteBusyError>()(
  "SettingsWriteBusyError",
  { settingsPath: Schema.String, attempts: Schema.Number },
) {
  override get message(): string {
    return `${this.settingsPath} kept changing while writing (gave up after ${this.attempts} attempts). Try again.`;
  }
}

export class SettingsWriteError extends Schema.TaggedError<SettingsWriteError>()(
  "SettingsWriteError",
  { settingsPath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not write ${this.settingsPath}.`;
  }
}

export const resolveSettingsPaths = Effect.fnUntraced(function* (
  explicitBaseDir: Option.Option<string>,
  development = false,
) {
  const envHome = Option.filter(
    yield* Config.String("SUPATERM_HOME").pipe(Config.option),
    (value) => value.trim().length > 0,
  );
  const configuredBaseDir = Option.orElse(explicitBaseDir, () => envHome);
  const baseDir = yield* resolveBaseDir(Option.getOrUndefined(configuredBaseDir));
  return yield* ServerConfig.deriveServerPaths(
    baseDir,
    development ? DEV_VARIANT_PLACEHOLDER_URL : undefined,
    {
      baseDirIsExplicit: Option.isSome(configuredBaseDir),
    },
  );
});

export const readSettingsObject = Effect.fnUntraced(function* (settingsPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs
    .exists(settingsPath)
    .pipe(Effect.mapError((cause) => new SettingsFileUnreadableError({ settingsPath, cause })));
  if (!exists) return { raw: "", settings: {} as Record<string, unknown> };

  const raw = yield* fs
    .readFileString(settingsPath)
    .pipe(Effect.mapError((cause) => new SettingsFileUnreadableError({ settingsPath, cause })));
  if (raw.trim().length === 0) return { raw, settings: {} as Record<string, unknown> };

  const settings = yield* decodeSettingsJson(raw).pipe(
    Effect.mapError((cause) => new SettingsFileMalformedError({ settingsPath, cause })),
  );
  return { raw, settings };
});

export const editSettingsObject = Effect.fnUntraced(function* (
  settingsPath: string,
  edit: (settings: Record<string, unknown>) => Record<string, unknown>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs
    .makeDirectory(path.dirname(settingsPath), { recursive: true })
    .pipe(Effect.mapError((cause) => new SettingsWriteError({ settingsPath, cause })));

  for (let attempt = 1; attempt <= CONCURRENT_WRITE_ATTEMPTS; attempt += 1) {
    const previous = yield* readSettingsObject(settingsPath);
    const contents = yield* encodeSettingsJson(edit(previous.settings)).pipe(
      Effect.mapError((cause) => new SettingsWriteError({ settingsPath, cause })),
    );
    const current = yield* readSettingsObject(settingsPath);
    if (current.raw !== previous.raw) continue;

    yield* writeFileStringAtomically({ filePath: settingsPath, contents: `${contents}\n` }).pipe(
      Effect.mapError((cause) => new SettingsWriteError({ settingsPath, cause })),
    );
    return;
  }

  return yield* new SettingsWriteBusyError({
    settingsPath,
    attempts: CONCURRENT_WRITE_ATTEMPTS,
  });
});
