import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { planAutoMarkDoneSettingsSync } from "./autoMarkDoneSettingsSync";

const reference = {
  environmentId: EnvironmentId.make("reference"),
  settings: {
    ...DEFAULT_SERVER_SETTINGS,
    sidebarAutoMarkDoneAfterDays: 7,
    sidebarAutoMarkDoneOnMerge: true,
    sidebarAutoMarkDoneKeepPullRequests: true,
    newWorktreesStartFromOrigin: false,
    continueThreadsAfterServerUpdate: false,
  },
};

describe("auto-mark-done settings sync", () => {
  it("ignores differences in independently configured environment settings", () => {
    const target = {
      environmentId: EnvironmentId.make("remote"),
      label: "Remote",
      settings: {
        ...reference.settings,
        newWorktreesStartFromOrigin: true,
        continueThreadsAfterServerUpdate: true,
        sourceControlWritingStyle: {
          ...reference.settings.sourceControlWritingStyle,
          customInstructions: "Keep this environment's writing instructions.",
        },
      },
    };

    const plan = planAutoMarkDoneSettingsSync(reference, [target]);

    expect(plan.mismatches).toEqual([]);
    expect(plan.patch).toEqual({
      sidebarAutoMarkDoneAfterDays: 7,
      sidebarAutoMarkDoneOnMerge: true,
      sidebarAutoMarkDoneKeepPullRequests: true,
    });
  });

  it("applies only auto-mark-done defaults when another environment differs", () => {
    const target = {
      environmentId: EnvironmentId.make("remote"),
      label: "Remote",
      settings: {
        ...reference.settings,
        sidebarAutoMarkDoneAfterDays: null,
        sidebarAutoMarkDoneOnMerge: false,
        sidebarAutoMarkDoneKeepPullRequests: false,
        newWorktreesStartFromOrigin: true,
        continueThreadsAfterServerUpdate: true,
        sourceControlWritingStyle: {
          ...reference.settings.sourceControlWritingStyle,
          customInstructions: "Preserve these instructions.",
        },
      },
    };

    const plan = planAutoMarkDoneSettingsSync(reference, [target]);
    const updated = { ...target.settings, ...plan.patch };

    expect(plan.mismatches).toEqual([target]);
    expect(updated.sidebarAutoMarkDoneAfterDays).toBe(7);
    expect(updated.sidebarAutoMarkDoneOnMerge).toBe(true);
    expect(updated.sidebarAutoMarkDoneKeepPullRequests).toBe(true);
    expect(updated.newWorktreesStartFromOrigin).toBe(true);
    expect(updated.continueThreadsAfterServerUpdate).toBe(true);
    expect(updated.sourceControlWritingStyle).toEqual(target.settings.sourceControlWritingStyle);
  });

  it("notices different project checkouts on the same environment", () => {
    const projectReference = { ...reference, projectId: ProjectId.make("one") };
    const otherCheckout = {
      environmentId: reference.environmentId,
      projectId: ProjectId.make("two"),
      label: "Other checkout",
      settings: { ...reference.settings, sidebarAutoMarkDoneAfterDays: null },
    };

    expect(planAutoMarkDoneSettingsSync(projectReference, [otherCheckout]).mismatches).toEqual([
      otherCheckout,
    ]);
  });
});
