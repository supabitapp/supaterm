// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { scanGlibcNeeds } from "./linux-glibc.ts";

const prepareServerCompileCache: (context: AfterPackContext) => Promise<void> =
  NodeModule.createRequire(import.meta.url)("./prepare-server-compile-cache.cjs");

interface AfterPackContext {
  readonly appOutDir: string;
  readonly electronPlatformName: string;
  readonly targets: ReadonlyArray<{
    readonly name: string;
    readonly options?: { depends?: string | string[] } | null;
  }>;
}

export default async function afterPack(context: AfterPackContext): Promise<void> {
  await prepareServerCompileCache(context);
  await removeSharedWriteAccess(context.appOutDir);
  const { minimum } = await scanGlibcNeeds(context.appOutDir);
  for (const target of context.targets) {
    if (target.name !== "deb") continue;
    if (!target.options || !Array.isArray(target.options.depends)) {
      throw new Error("Linux deb target must configure its dependencies before afterPack");
    }
    target.options.depends = [
      ...target.options.depends.filter((dependency) => !dependency.startsWith("libc6 ")),
      `libc6 (>= ${minimum})`,
    ];
  }
}

export async function removeSharedWriteAccess(path: string): Promise<void> {
  const stats = await NodeFSP.lstat(path);
  if (stats.isSymbolicLink()) return;
  if (stats.mode & 0o022) await NodeFSP.chmod(path, stats.mode & 0o7755);
  if (!stats.isDirectory()) return;
  for (const entry of await NodeFSP.readdir(path)) {
    await removeSharedWriteAccess(NodePath.join(path, entry));
  }
}
