import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { BRAND_ASSET_PATHS } from "./brand-assets.ts";
import { recolorBoltSvg } from "./icon-artwork.ts";

const DERIVED_PROJECTS = [
  { source: BRAND_ASSET_PATHS.nightlyIconComposerProject, hue: 285 },
  { source: BRAND_ASSET_PATHS.developmentIconComposerProject, hue: 195 },
] as const;

const projectFiles = Effect.fn("iconProjects.projectFiles")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(directory))) return [];
  const entries = yield* fs.readDirectory(directory, { recursive: true });
  return yield* Effect.filter(entries, (entry) =>
    fs.stat(path.join(directory, entry)).pipe(Effect.map((info) => info.type === "File")),
  );
});

export const generateIconProjects = Effect.fn("generateIconProjects")(function* (
  repositoryRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = BRAND_ASSET_PATHS.productionIconComposerProject;
  const production = path.join(repositoryRoot, source);
  const files = new Map<string, Buffer>();
  for (const relative of yield* projectFiles(production)) {
    const contents = Buffer.from(yield* fs.readFile(path.join(production, relative)));
    files.set(path.join(source, relative), contents);
    for (const project of DERIVED_PROJECTS) {
      const name = path.basename(relative);
      const derived =
        name === "04-Phosphor-Glow.svg" || name === "05-Glass-Lightning.svg"
          ? Buffer.from(recolorBoltSvg(contents.toString("utf8"), project.hue))
          : contents;
      files.set(path.join(project.source, relative), derived);
    }
  }
  const obsolete: Array<string> = [];
  for (const project of DERIVED_PROJECTS) {
    for (const relative of yield* projectFiles(path.join(repositoryRoot, project.source))) {
      const file = path.join(project.source, relative);
      if (!files.has(file)) obsolete.push(file);
    }
  }
  return { files, obsolete };
});
