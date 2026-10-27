import type { EnvironmentConnectionPhase } from "@supaterm/client-runtime/connection";
import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type AddProjectPaths,
  addProjectPathFor,
  resolveAddProjectEnvironment,
  withAddProjectPath,
} from "./AddProjectScreen.logic";

const ENVIRONMENT_A = EnvironmentId.make("environment-a");
const ENVIRONMENT_B = EnvironmentId.make("environment-b");

function environment(environmentId: EnvironmentId, connectionState: EnvironmentConnectionPhase) {
  return { environmentId, connectionState };
}

describe("resolveAddProjectEnvironment", () => {
  it("does not redirect an explicit unavailable environment to another environment", () => {
    expect(
      resolveAddProjectEnvironment(
        [environment(ENVIRONMENT_A, "offline"), environment(ENVIRONMENT_B, "connected")],
        ENVIRONMENT_A,
      ),
    ).toBeNull();
  });
});

describe("Add project path per host", () => {
  const initial: AddProjectPaths = { byHost: new Map(), last: "~/" };

  it("shows a newly selected host's default instead of another host's typed path", () => {
    const typed = withAddProjectPath(initial, ENVIRONMENT_A, "/work/edited");
    expect(addProjectPathFor(typed, ENVIRONMENT_B, "~/")).toBe("~/");
  });

  it("keeps each host's typed path when switching between hosts", () => {
    let paths = withAddProjectPath(initial, ENVIRONMENT_A, "/work/a");
    paths = withAddProjectPath(paths, ENVIRONMENT_B, "~/b");
    expect(addProjectPathFor(paths, ENVIRONMENT_A, "/work/")).toBe("/work/a");
    expect(addProjectPathFor(paths, ENVIRONMENT_B, "~/")).toBe("~/b");
  });

  it("keeps a typed path while the host drops out and when it comes back", () => {
    const paths = withAddProjectPath(initial, ENVIRONMENT_A, "~/code/app");
    expect(addProjectPathFor(paths, null, "/work/")).toBe("~/code/app");
    expect(addProjectPathFor(paths, ENVIRONMENT_A, "~/")).toBe("~/code/app");
  });
});
