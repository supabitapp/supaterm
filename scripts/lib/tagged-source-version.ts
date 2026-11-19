// @effect-diagnostics-next-line nodeBuiltinImport:off -- Build configs resolve the tag before an Effect runtime exists.
import * as NodeChildProcess from "node:child_process";

export const releasePackageFiles = [
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
] as const;

/**
 * A release is tagged on the commit it was built from, and the manifest bump lands on main
 * afterwards, so source at `vX.Y.Z` still carries the previous version. Server, web and desktop
 * builds must all resolve through here, or the client reports a different version than its server.
 */
export function resolveTaggedSourceVersion(repoRoot: string, manifestVersion: string) {
  const git = (...args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });

  try {
    git("diff", "--quiet", "HEAD", "--", ...releasePackageFiles);
    const stableTags = git("tag", "--points-at", "HEAD")
      .split("\n")
      .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
    if (stableTags.length === 1) return stableTags[0]!.slice(1);
  } catch {}
  return manifestVersion;
}
