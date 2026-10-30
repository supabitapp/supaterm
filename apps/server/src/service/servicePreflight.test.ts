import { expect, it } from "@effect/vitest";

import { runServicePreflight } from "./servicePreflight.ts";

it.each([1, 2])("blocks legacy launcher protocol %i", (launcherProtocol) => {
  expect(
    runServicePreflight({
      launcherProtocol,
      version: "1.2.3",
    }),
  ).toMatchObject({ status: "blocked", version: "1.2.3" });
  const result = runServicePreflight({ launcherProtocol, version: "1.2.3" });
  if (result.status !== "blocked") throw new Error("Expected a blocked launcher");
  expect(result.reason).toContain(`protocol ${launcherProtocol}`);
  expect(result.reason).toContain("SUPATERM_VERSION=1.2.3");
  expect(result.reason).toContain("https://supaterm.com/install.sh");
  expect(result.reason).toContain("~/.local/bin/supaterm service install");
  expect(result.reason).not.toContain("supaterm service update");
});
