import { expect, it } from "@effect/vitest";

import { runServicePreflight } from "./servicePreflight.ts";

it.each([1])("blocks legacy launcher protocol %i", (launcherProtocol) => {
  expect(
    runServicePreflight({
      launcherProtocol,
      version: "1.2.3",
    }),
  ).toEqual({
    status: "blocked",
    version: "1.2.3",
    reason:
      "This release requires a newer Supaterm service launcher. Update it on the server machine.",
  });
});
