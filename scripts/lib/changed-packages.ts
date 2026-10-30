// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - plain Node helper for scripts/check-changed.ts.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const ROOT = NodePath.resolve(import.meta.dirname, "../..");

const INERT = [
  /^docs\//,
  /^\.(agents|claude|cursor|vscode|devcontainer|macroscope)\//,
  /^[^/]+\.md$/,
  /^LICENSE$/,
];

const AFFECTS_EVERYTHING = [
  /^packages\/shared\/src\/(HostProcess|testing\/longTempDir|testing\/providerEnv)\.ts$/,
  /^apps\/mobile\/deps\//,
];

const EXTRA_OWNERS: ReadonlyArray<readonly [RegExp, ReadonlyArray<string>]> = [
  [/^scripts\/lib\//, ["@supaterm/desktop", "@supaterm/mobile", "@supaterm/web", "supaterm"]],

  [/^apps\/desktop\/gnome-extension\//, ["@supaterm/scripts"]],
  [/^native\/browser-secret\//, ["@supaterm/desktop"]],
  [/^native\/(kde|hyprland)-snap-shot\//, ["@supaterm/desktop"]],
  [/^native\/libghostty-vt\//, ["@supaterm/web", "@supaterm/mobile"]],
];
const RUST = /^native\/(resource-monitor|kde-snap-shot|hyprland-snap-shot)\//;

const TEST_ONLY_DEPS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "@supaterm/provider-pi": ["@supaterm/client-runtime"],
  "@supaterm/scripts": [
    "@supaterm/desktop",
    "@supaterm/mobile",
    "@supaterm/web",
    "supaterm",
    "@supaterm/provider-cursor",
  ],
};

const BUILD_ONLY_DEPS: Readonly<Record<string, ReadonlyArray<string>>> = {
  supaterm: ["@supaterm/web"],
};

export interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly deps: ReadonlyArray<string>;
}

interface PackageManifest {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

export function readWorkspace(root = ROOT): Array<WorkspacePackage> {
  const patterns: Array<string> = [];
  let inPackages = false;
  for (const line of NodeFS.readFileSync(NodePath.join(root, "pnpm-workspace.yaml"), "utf8").split(
    "\n",
  )) {
    if (/^\S/.test(line)) inPackages = line.startsWith("packages:");
    const entry = inPackages ? /^\s+-\s+["']?([^"'\s]+)/.exec(line) : null;
    if (entry?.[1] !== undefined) patterns.push(entry[1]);
  }

  const dirs = patterns.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return NodeFS.readdirSync(NodePath.join(root, parent)).map((name) => `${parent}/${name}`);
  });

  const packages: Array<WorkspacePackage> = [];
  for (const dir of dirs) {
    const manifestPath = NodePath.join(root, dir, "package.json");
    if (!NodeFS.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(NodeFS.readFileSync(manifestPath, "utf8")) as PackageManifest;
    const deps = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };
    packages.push({
      name: manifest.name,
      dir,
      deps: Object.keys(deps).filter(
        (dep) =>
          String(deps[dep]).startsWith("workspace:") &&
          !BUILD_ONLY_DEPS[manifest.name]?.includes(dep),
      ),
    });
  }
  return packages;
}

function ownersOf(
  file: string,
  packages: ReadonlyArray<WorkspacePackage>,
): ReadonlyArray<string> | null {
  if (INERT.some((pattern) => pattern.test(file))) return [];

  if (NodePath.posix.basename(file) === "package.json") return null;
  if (AFFECTS_EVERYTHING.some((pattern) => pattern.test(file))) return null;
  const extra = EXTRA_OWNERS.flatMap(([pattern, names]) => (pattern.test(file) ? names : []));

  if (RUST.test(file)) return ["@supaterm/scripts", ...extra];

  const owner = packages
    .filter((pkg) => file.startsWith(`${pkg.dir}/`))
    .toSorted((a, b) => b.dir.length - a.dir.length)[0];
  if (owner) return [owner.name, ...extra];
  return extra.length > 0 ? extra : null;
}

export function affectedPackages(
  files: ReadonlyArray<string>,
  packages: ReadonlyArray<WorkspacePackage>,
): { readonly affected: Array<string>; readonly everything: boolean } {
  let affected = new Set<string>();
  let everything = false;

  for (const file of files) {
    const owners = ownersOf(file, packages);
    if (owners === null) {
      everything = true;
      console.error(`Affects every package: ${file}`);
    } else {
      for (const owner of owners) affected.add(owner);
    }
  }

  if (everything) {
    affected = new Set(packages.map((pkg) => pkg.name));
  } else {
    let grew = true;
    while (grew) {
      grew = false;
      for (const pkg of packages) {
        const deps = [...pkg.deps, ...(TEST_ONLY_DEPS[pkg.name] ?? [])];
        if (!affected.has(pkg.name) && deps.some((dep) => affected.has(dep))) {
          affected.add(pkg.name);
          grew = true;
        }
      }
    }
  }

  return { affected: [...affected].toSorted(), everything };
}
