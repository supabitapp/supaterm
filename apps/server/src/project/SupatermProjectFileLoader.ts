/**
 * SupatermProjectFileLoader - Effect service that loads the checked-in `supaterm.json`
 * project file from a workspace root.
 *
 * Loading is best-effort: a missing file resolves to `Option.none`, and
 * unreadable or invalid files are logged and treated as absent so callers
 * can fall back to their defaults.
 *
 * @module SupatermProjectFileLoader
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { SUPATERM_PROJECT_FILE_NAME, type SupatermProjectFile } from "@supaterm/contracts";
import { SupatermProjectFileFromJson } from "@supaterm/shared/supatermProjectFile";

const decodeSupatermProjectFileJson = Schema.decodeEffect(SupatermProjectFileFromJson);

export class SupatermProjectFileLoadError extends Schema.TaggedError<SupatermProjectFileLoadError>()(
  "SupatermProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${SUPATERM_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

/** Service tag for supaterm.json project file loading. */
export class SupatermProjectFileLoader extends Context.Service<
  SupatermProjectFileLoader,
  {
    /**
     * Load and decode `supaterm.json` at the workspace root.
     *
     * Never fails: missing, unreadable, or invalid files resolve to
     * `Option.none` (invalid files are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<SupatermProjectFile>>;
  }
>()("supaterm/project/SupatermProjectFileLoader") {}

const logSupatermProjectFileLoadError = (error: SupatermProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: SupatermProjectFileLoader["Service"]["load"] = Effect.fn(
    "SupatermProjectFileLoader.load",
  )(function* (workspaceRoot) {
    const filePath = path.join(workspaceRoot, SUPATERM_PROJECT_FILE_NAME);
    const raw = yield* fileSystem.readFileString(filePath).pipe(
      Effect.asSome,
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : logSupatermProjectFileLoadError(
                new SupatermProjectFileLoadError({
                  operation: "read",
                  workspaceRoot,
                  filePath,
                  cause: error,
                }),
              ).pipe(Effect.as(Option.none<string>())),
      }),
    );
    if (Option.isNone(raw)) {
      return Option.none<SupatermProjectFile>();
    }
    return yield* decodeSupatermProjectFileJson(raw.value).pipe(
      Effect.asSome,
      Effect.catchTags({
        SchemaError: (error) =>
          logSupatermProjectFileLoadError(
            new SupatermProjectFileLoadError({
              operation: "decode",
              workspaceRoot,
              filePath,
              cause: error,
            }),
          ).pipe(Effect.as(Option.none<SupatermProjectFile>())),
      }),
    );
  });

  return SupatermProjectFileLoader.of({ load });
});

export const layer = Layer.effect(SupatermProjectFileLoader, make);
