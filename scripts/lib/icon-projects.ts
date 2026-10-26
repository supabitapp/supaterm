import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { BRAND_ASSET_PATHS, ICON_DOCUMENT } from "./brand-assets.ts";
import { ICON_CHANNELS, type IconChannel, type StudioIconRender } from "./studio-icon-render.ts";

/** The rendered layers' file names inside a project's `Assets`, bottom to top. */
export const ICON_LAYERS = {
  housing: "01-Housing.png",
  screen: "02-Screen.png",
  bezel: "03-Bezel.png",
} as const;

const PROJECTS = {
  prod: BRAND_ASSET_PATHS.productionIconComposerProject,
  nightly: BRAND_ASSET_PATHS.nightlyIconComposerProject,
  dev: BRAND_ASSET_PATHS.developmentIconComposerProject,
} as const satisfies Record<IconChannel, string>;

const projectFiles = Effect.fn("iconProjects.projectFiles")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(directory))) return [];
  const entries = yield* fs.readDirectory(directory, { recursive: true });
  return yield* Effect.filter(entries, (entry) =>
    fs.stat(path.join(directory, entry)).pipe(Effect.map((info) => info.type === "File")),
  );
});

/**
 * Each channel's Icon Composer project: the production `icon.json`, which holds the appearance
 * settings and stays editable, around that channel's rendered layers.
 */
export const generateIconProjects = Effect.fn("generateIconProjects")(function* (
  repositoryRoot: string,
  renders: Readonly<Record<IconChannel, StudioIconRender>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const document = Buffer.from(
    yield* fs.readFile(path.join(repositoryRoot, PROJECTS.prod, ICON_DOCUMENT)),
  );
  const files = new Map<string, Buffer>();
  for (const channel of ICON_CHANNELS) {
    const project = PROJECTS[channel];
    const { housing, screen, bezel } = renders[channel];
    files.set(path.join(project, ICON_DOCUMENT), document);
    files.set(path.join(project, "Assets", ICON_LAYERS.housing), housing);
    files.set(path.join(project, "Assets", ICON_LAYERS.screen), screen);
    files.set(path.join(project, "Assets", ICON_LAYERS.bezel), bezel);
  }
  const obsolete: Array<string> = [];
  for (const project of Object.values(PROJECTS)) {
    for (const relative of yield* projectFiles(path.join(repositoryRoot, project))) {
      const file = path.join(project, relative);
      if (!files.has(file)) obsolete.push(file);
    }
  }
  return { files, obsolete };
});
