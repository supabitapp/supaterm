import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const CONFIG_FILES = [
  "app.config.ts",
  "app.config.mts",
  "app.config.js",
  "app.config.mjs",
  "app.config.cjs",
];
const JSON_CONFIG_FILES = ["app.config.json", "app.json"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUOTED_PROJECT_ID =
  /\bprojectId["']?\s*:\s*["'`]([^"'`\n]*)["'`](?=(?:\s|\/\/[^\n\r\u2028\u2029]*(?:[\n\r\u2028\u2029]|$)|\/\*(?:[^*]|\*(?!\/))*\*\/)*(?:[,;})\]]|$))/gi;
const PROJECT_ID_MENTION = /\bprojectId\b/gi;
const MAX_CONFIG_LENGTH = 256 * 1024;
const MAX_MENTIONS = 32;

const SPREAD_LATER = /\.\.\./;
const SPREAD_FILLER = /(?:\s+|\/\/[^\n\r\u2028\u2029]*|\/\*(?:[^*]|\*(?!\/))*\*\/|\()/y;
const EXTRA_OF_CONFIG = String.raw`config(?:\s*\??\.\s*extra|\s*(?:\?\.)?\s*\[\s*["'\x60]extra["'\x60]\s*\])`;
const EAS_OF_CONFIG =
  EXTRA_OF_CONFIG + String.raw`(?:\s*\??\.\s*eas|\s*(?:\?\.)?\s*\[\s*["'\x60]eas["'\x60]\s*\])`;
const HOLDER_END = String.raw`(?![\p{ID_Continue}$\u200c\u200d\\]|\s*(?:[.\[(]|\?(?!\?)))`;
const HOLDER_AT = {
  extra: new RegExp(EXTRA_OF_CONFIG + HOLDER_END, "uy"),
  eas: new RegExp(EAS_OF_CONFIG + HOLDER_END, "uy"),
};
const CONFIG_AT = new RegExp("config" + HOLDER_END, "uy");
const CONFIG_PART_AT = new RegExp(
  String.raw`config(?:\s*\??\.\s*(?!extra(?![\p{ID_Continue}$]))([\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*))+` +
    HOLDER_END,
  "uy",
);
const PART_OPENER =
  /(?<=[{,]\s*["']?([\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*)["']?\s*:\s*[[{]\s*)/uy;

const staticConfigUse = (source: string): "spreads" | "replaces" | "unclear" => {
  let spreads = 0;
  let at = 0;
  for (;;) {
    const next = source.indexOf("...", at);
    if (next === -1) return spreads > 0 ? "spreads" : "unclear";
    at = next + 3;
    for (;;) {
      SPREAD_FILLER.lastIndex = at;
      const filler = SPREAD_FILLER.exec(source);
      if (!filler) break;
      at += filler[0].length;
    }
    CONFIG_AT.lastIndex = at;
    if (CONFIG_AT.test(source)) {
      spreads++;
      continue;
    }
    CONFIG_PART_AT.lastIndex = at;
    const part = CONFIG_PART_AT.exec(source);
    PART_OPENER.lastIndex = next;
    const opener = part && PART_OPENER.exec(source);
    if (opener && opener[1] === part[1] && opener[1] !== "expo") continue;
    HOLDER_AT.extra.lastIndex = at;
    HOLDER_AT.eas.lastIndex = at;
    if (!HOLDER_AT.extra.test(source) && !HOLDER_AT.eas.test(source)) return "replaces";
  }
};
const ASSIGNS_OVER = /\bObject\s*\.\s*assign\b|\bassign\s*\(/;
const REPLACES_HOLDER =
  /(?:\.\s*(?:extra|eas)|\[\s*["'`](?:extra|eas)["'`]\s*\])\s*=(?!=)|\bdelete\b|\brequire\s*\(|\bimport\s*\((?!\s*(["'])expo\/config\1\s*\)\s*\.\s*[A-Z])/;
const EXTRA_OR_EAS = /(?:\b(extra|eas)|["'`](extra|eas)["'`]\s*\]?)\s*:\s*/g;
const SHORTHAND_EXTRA_OR_EAS = /(?<![.\p{ID_Continue}$])(?:extra|eas)\s*(?=[,}])/u;
const keepsStaticExtra = (source: string): boolean => {
  if (SHORTHAND_EXTRA_OR_EAS.test(source)) return false;
  let entries = 0;
  for (const entry of source.matchAll(EXTRA_OR_EAS)) {
    if (++entries > MAX_MENTIONS) return false;
    const holder = HOLDER_AT[(entry[1] ?? entry[2]) as "extra" | "eas"];
    let at = entry.index + entry[0].length;
    if (source[at] !== "{") return false;
    at++;
    for (;;) {
      SPREAD_FILLER.lastIndex = at;
      const filler = SPREAD_FILLER.exec(source);
      if (!filler) break;
      at += filler[0].length;
    }
    if (!source.startsWith("...", at)) return false;
    at += 3;
    for (;;) {
      SPREAD_FILLER.lastIndex = at;
      const filler = SPREAD_FILLER.exec(source);
      if (!filler) break;
      at += filler[0].length;
    }
    holder.lastIndex = at;
    if (!holder.test(source)) return false;
  }
  return true;
};

const Extra = Schema.optional(
  Schema.Struct({
    eas: Schema.optional(Schema.Struct({ projectId: Schema.optional(Schema.String) })),
  }),
);
const decodeAppJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ expo: Schema.optional(Schema.Struct({ extra: Extra })), extra: Extra }),
  ),
);

const projectIdsOf = Effect.fn("easProjectId.projectIdsOf")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ids: Array<string> = [];
  const configFile = yield* Effect.findFirst(CONFIG_FILES, (file) =>
    fs.exists(path.join(dir, file)).pipe(Effect.orElseSucceed(() => false)),
  );
  if (Option.isSome(configFile)) {
    const source = yield* fs
      .readFileString(path.join(dir, configFile.value))
      .pipe(Effect.orElseSucceed(() => "projectId"));
    if (source.length > MAX_CONFIG_LENGTH) return null;
    const mentions = source.match(PROJECT_ID_MENTION)?.length ?? 0;
    if (mentions > MAX_MENTIONS) return null;
    const entries = [...source.matchAll(QUOTED_PROJECT_ID)];
    const quoted = entries.map((match) => match[1]!);
    if (
      quoted.length !== mentions ||
      quoted.some((id) => id.includes("${")) ||
      ASSIGNS_OVER.test(source) ||
      REPLACES_HOLDER.test(source) ||
      entries.some((match) => SPREAD_LATER.test(source.slice(match.index + match[0].length)))
    ) {
      return null;
    }
    if (
      !quoted.some((id) => UUID.test(id)) &&
      (staticConfigUse(source) !== "spreads" || !keepsStaticExtra(source))
    ) {
      return null;
    }
    ids.push(
      ...quoted
        .values()
        .filter((id) => UUID.test(id))
        .map((id) => id.toLowerCase())
        .toArray(),
    );
  }
  for (const file of JSON_CONFIG_FILES) {
    const json = yield* fs.readFileString(path.join(dir, file)).pipe(
      Effect.asSome,
      Effect.catch((error) =>
        Effect.succeed(error.reason._tag === "NotFound" ? Option.none<string>() : null),
      ),
    );
    if (json === null) return null;
    if (Option.isNone(json)) continue;
    const decoded = decodeAppJson(json.value);
    if (Option.isNone(decoded)) return null;
    const id = (decoded.value.expo ?? decoded.value).extra?.eas?.projectId;
    if (id !== undefined && UUID.test(id)) ids.push(id.toLowerCase());
    break;
  }
  return ids;
});

/**
 * The Expo project of a workspace's Expo app: its root, or one app below
 * `apps/` or `packages/`. None when there is none, a config is ambiguous, or
 * the apps disagree, so the caller asks for an explicit choice instead of
 * billing the wrong project.
 */
export const findEasProjectId = Effect.fn("easProjectId.findEasProjectId")(function* (
  workspaceRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const isDirectory = (child: string) =>
    fs.stat(child).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
  const children = (parent: string) =>
    fs.readDirectory(path.join(workspaceRoot, parent)).pipe(
      Effect.map((names) => names.map((name) => path.join(workspaceRoot, parent, name))),
      Effect.flatMap((paths) =>
        Effect.forEach(paths, (child) =>
          Effect.map(isDirectory(child), (directory) => (directory ? [child] : [])),
        ),
      ),
      Effect.map((kept) => kept.flat()),
      Effect.orElseSucceed(() => []),
    );
  const directories = [
    workspaceRoot,
    ...(yield* children("apps")),
    ...(yield* children("packages")),
  ];
  const ids = yield* Effect.forEach(directories, projectIdsOf, { concurrency: 4 });
  if (ids.some((found) => found === null)) return Option.none<string>();
  const distinct = new Set(ids.flatMap((found) => found ?? []));
  return distinct.size === 1 ? Option.some([...distinct][0]!) : Option.none<string>();
});
