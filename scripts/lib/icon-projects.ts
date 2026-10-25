import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { BRAND_ASSET_PATHS } from "./brand-assets.ts";
import { ICON_CHANNELS, type IconChannel, type StudioIconRender } from "./studio-icon-render.ts";

const PROJECTS = {
  prod: BRAND_ASSET_PATHS.productionIconComposerProject,
  nightly: BRAND_ASSET_PATHS.nightlyIconComposerProject,
  dev: BRAND_ASSET_PATHS.developmentIconComposerProject,
} as const satisfies Record<IconChannel, string>;

export const ICON_DOCUMENT = "icon.json";

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
    files.set(path.join(project, "Assets", "01-Housing.png"), housing);
    files.set(path.join(project, "Assets", "02-Screen.png"), screen);
    files.set(path.join(project, "Assets", "03-Bezel.png"), bezel);
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
