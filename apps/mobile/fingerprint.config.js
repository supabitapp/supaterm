// @ts-check
const fs = require("node:fs");
const path = require("node:path");

// Include the major version, which Expo ignores, to prevent OTAs reaching older store binaries.
const appConfig = fs.readFileSync(path.join(__dirname, "app.config.ts"), "utf8");
const majorVersion = appConfig.match(/^ {2}version: "(\d+)\./m)?.[1];
if (!majorVersion) {
  throw new Error("fingerprint.config.js could not read the app version from app.config.ts");
}

// The fingerprint hashes native modules by name and version, so a pnpm patch
// to their native code would leave the runtime version unchanged and ship as
// an OTA to binaries that lack it. Hash every applied patch that touches
// platform sources, C/C++, or codegen specs. JS-only patches ship in the
// bundle and stay out.
const repoRoot = path.join(__dirname, "../..");
const workspaceConfig = fs.readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
const appliedPatches = [...workspaceConfig.matchAll(/: (patches\/\S+\.patch)$/gm)].flatMap(
  ([, patch]) => (patch ? [patch] : []),
);
const nativePath =
  /^(ios|android|cpp)\/|(^|\/)cpp\/|\.(c|cc|cpp|h|hpp|m|mm|swift|kt|java)$|\.podspec$|(^|\/)Native\w*\.tsx?$|NativeComponent\.tsx?$/;
const nativePatchSources = appliedPatches.flatMap((patch) => {
  const contents = fs.readFileSync(path.join(repoRoot, patch), "utf8");
  const touchesNative = [...contents.matchAll(/^diff --git a\/(\S+)/gm)].some(([, touched = ""]) =>
    nativePath.test(touched),
  );
  return touchesNative ? [{ type: /** @type {const} */ ("contents"), id: patch, contents }] : [];
});

module.exports = {
  nativeModuleSourceType: "files",
  extraSources: [
    { type: "contents", id: "appMajorVersion", contents: majorVersion },
    ...nativePatchSources,
  ],
};
