import { assert, describe, it } from "@effect/vitest";

import { affectedPackages, type WorkspacePackage } from "./changed-packages.ts";

const packages: ReadonlyArray<WorkspacePackage> = [
  { name: "@supaterm/shared", dir: "packages/shared", deps: [] },
  { name: "@supaterm/contracts", dir: "packages/contracts", deps: ["@supaterm/shared"] },
  { name: "@supaterm/web", dir: "apps/web", deps: ["@supaterm/contracts"] },
  { name: "@supaterm/mobile", dir: "apps/mobile", deps: ["@supaterm/contracts"] },
  { name: "@supaterm/desktop", dir: "apps/desktop", deps: [] },
  { name: "supaterm", dir: "apps/server", deps: ["@supaterm/contracts"] },
  { name: "@supaterm/scripts", dir: "scripts", deps: [] },
];

describe("affectedPackages", () => {
  it("adds dependents of a changed package until the graph is closed", () => {
    assert.deepStrictEqual(affectedPackages(["packages/contracts/src/a.ts"], packages), {
      // The scripts tests read the apps' files without declaring them.
      affected: [
        "@supaterm/contracts",
        "@supaterm/mobile",
        "@supaterm/scripts",
        "@supaterm/web",
        "supaterm",
      ],
      everything: false,
    });
  });

  it("ignores docs and maps native sources to the apps that build them", () => {
    assert.deepStrictEqual(affectedPackages(["docs/user/composer.md"], packages).affected, []);
    assert.deepStrictEqual(
      affectedPackages(["native/libghostty-vt/build.zig"], packages).affected,
      ["@supaterm/mobile", "@supaterm/scripts", "@supaterm/web"],
    );
    assert.deepStrictEqual(
      affectedPackages(["native/hyprland-snap-shot/src/main.rs"], packages).affected,
      ["@supaterm/desktop", "@supaterm/scripts"],
    );
  });

  it("affects every package for manifests, shared test setup, and unknown paths", () => {
    for (const file of [
      "apps/web/package.json",
      "packages/shared/src/testing/providerEnv.ts",
      "some-new-root-file.ts",
    ]) {
      const result = affectedPackages([file], packages);
      assert.isTrue(result.everything, file);
      assert.lengthOf(result.affected, packages.length);
    }
  });
});
