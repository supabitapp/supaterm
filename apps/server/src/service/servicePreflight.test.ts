import { expect, it } from "@effect/vitest";

import { runServicePreflight } from "./servicePreflight.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "./serviceProtocol.ts";

it.each([1])("blocks legacy launcher protocol %i with exact recovery steps", (launcherProtocol) => {
  const result = runServicePreflight({
    launcherProtocol,
    version: "9.8.7",
  });

  expect(result).toMatchObject({ status: "blocked", version: "9.8.7" });
  const reason = result.status === "blocked" ? result.reason : "";
  expect(reason).toMatch(new RegExp(`\\b${launcherProtocol}\\b`));
  expect(reason).toMatch(new RegExp(`\\b${SERVICE_LAUNCHER_PROTOCOL}\\b`));
  expect(reason).toContain(
    "curl -fsSL https://supaterm.com/install.sh | SUPATERM_VERSION=9.8.7 sh",
  );
  expect(reason).toContain("~/.local/bin/supaterm service install");
  expect(reason).toContain("supaterm --version");
  expect(reason).toContain("which -a supaterm");
});
