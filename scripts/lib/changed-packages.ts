// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - plain Node helper for scripts/check-changed.ts.
// Maps changed paths to the workspace packages they affect, plus those
// packages' dependents from package.json. A path this file does not recognize
// affects every package, so a new root file or directory can only cost minutes.
// Only scripts/check-changed.ts reads this; CI runs every job on every push.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const ROOT = NodePath.resolve(import.meta.dirname, "../..");

// Never read by a build, typecheck, or test. Lint still formats them.
const INERT = [
  /^docs\//,
  /^\.(agents|claude|cursor|vscode|devcontainer|macroscope)\//,
  /^[^/]+\.md$/,
  /^LICENSE$/,
];

// Every package: the root vite.config.ts loads these as setup for every
// package's tests, and the vendored mobile tarballs are installed dependencies.
const AFFECTS_EVERYTHING = [
  /^packages\/shared\/src\/(HostProcess|testing\/longTempDir|testing\/providerEnv)\.ts$/,
  /^apps\/mobile\/deps\//,
];

// Paths outside a package, or files inside one that other packages read
// through relative imports rather than a package.json dependency.
const EXTRA_OWNERS: ReadonlyArray<readonly [RegExp, ReadonlyArray<string>]> = [
  // Vite configs and tsconfigs of these apps import scripts/lib directly.
  [/^scripts\/lib\//, ["@supaterm/desktop", "@supaterm/mobile", "@supaterm/web", "supaterm"]],
  // scripts/build-desktop-artifact.ts reads the GNOME extension manifest.
  [/^apps\/desktop\/gnome-extension\//, ["@supaterm/scripts"]],
  [/^native\/browser-secret\//, ["@supaterm/desktop"]],
  [/^native\/(kde|hyprland)-snap-shot\//, ["@supaterm/desktop"]],
  [/^native\/libghostty-vt\//, ["@supaterm/web", "@supaterm/mobile"]],
];
const RUST = /^native\/(resource-monitor|kde-snap-shot|hyprland-snap-shot)\//;

// Tests that read another package's files without declaring it. The scripts
// tests read app manifests, assets, and sources (cursor-sdk-packaging,
// third-party-licenses, brand-assets, build-desktop-artifact).
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
// Declared dependencies that only feed a build step: the server bundles the
// built web app (apps/server/vite.config.ts) but never imports it.
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

// The packages a path touches, [] for an inert path, or null when the path is
// not understood and every package is affected.
function ownersOf(
  file: string,
  packages: ReadonlyArray<WorkspacePackage>,
): ReadonlyArray<string> | null {
  if (INERT.some((pattern) => pattern.test(file))) return [];
  // A manifest can change dependencies or versions other packages read.
  if (NodePath.posix.basename(file) === "package.json") return null;
  if (AFFECTS_EVERYTHING.some((pattern) => pattern.test(file))) return null;
  const extra = EXTRA_OWNERS.flatMap(([pattern, names]) => (pattern.test(file) ? names : []));
  // scripts/build-desktop-artifact.test.ts reads the crates' sources.
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
    // Add dependents until nothing changes.
    let grew = true;
    while (grew) {
      grew = false;
      for (const pkg of packages) {
        if (!affected.has(pkg.name) && pkg.deps.some((dep) => affected.has(dep))) {
          affected.add(pkg.name);
          grew = true;
        }
      }
    }
    for (const [name, deps] of Object.entries(TEST_ONLY_DEPS)) {
      if (deps.some((dep) => affected.has(dep))) affected.add(name);
    }
  }

  return { affected: [...affected].toSorted(), everything };
}
