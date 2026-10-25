// @effect-diagnostics nodeBuiltinImport:off - Build bootstrap reads optional root env files before an Effect runtime exists.
import { pipe } from "effect/Function";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

type Environment = Readonly<Record<string, string | undefined>>;

const REPO_ROOT = pipe(
  NodeURL.fileURLToPath(import.meta.url),
  NodePath.dirname,
  NodePath.dirname,
  NodePath.dirname,
);

export function loadRepoEnv({
  baseEnv = process.env,
  repoRoot = REPO_ROOT,
}: {
  readonly baseEnv?: Environment;
  readonly repoRoot?: string;
} = {}): Record<string, string | undefined> {
  return {
    ...readEnvFile(NodePath.join(repoRoot, ".env")),
    ...readEnvFile(NodePath.join(repoRoot, ".env.local")),
    ...baseEnv,
  };
}

function readEnvFile(path: string): Record<string, string | undefined> {
  return NodeFS.existsSync(path) ? NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8")) : {};
}
