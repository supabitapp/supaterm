import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type OrchestrationSkillsStatus } from "@supaterm/contracts";
import { runOrchestrationSkillsAction, orchestrationSkillsView } from "./orchestrationSkills.ts";

const environments = ["local", "remote"].map((label) => ({
  label,
  environmentId: EnvironmentId.make(label),
}));
const installed: OrchestrationSkillsStatus = {
  targets: [
    {
      directory: "/skills",
      providers: ["Claude"],
      skills: [{ name: "supaterm-advisor", state: "installed", managed: true }],
    },
  ],
  unsupportedProviders: [],
};

describe("orchestration skill scope", () => {
  it("installs on every selected environment and preserves successes when another fails", async () => {
    const changed = new Set<EnvironmentId>();
    const results = await runOrchestrationSkillsAction(environments, async (id) => {
      if (id === environments[0]!.environmentId) throw new Error("disconnected");
      changed.add(id);
      return installed;
    });
    expect(changed).toEqual(new Set([environments[1]!.environmentId]));
    expect(results[0]?.status).toBeNull();
    expect(results[1]?.status).toEqual(installed);
    expect(orchestrationSkillsView(results[1]!.status).canUninstall).toBe(true);
  });

  it("limits the operation to the selected subset", async () => {
    const changed = new Set<EnvironmentId>();
    await runOrchestrationSkillsAction(environments.slice(0, 1), async (id) => {
      changed.add(id);
      return installed;
    });
    expect(changed).toEqual(new Set([environments[0]!.environmentId]));
  });

  it("offers install when another folder or link holds a skill name", () => {
    const view = orchestrationSkillsView({
      ...installed,
      targets: [
        {
          ...installed.targets[0]!,
          skills: [{ name: "supaterm-advisor", state: "conflict", managed: false }],
        },
      ],
    });
    expect(view).toEqual({
      canInstall: true,
      canUninstall: false,
      installed: false,
      conflict: true,
    });
  });
});
