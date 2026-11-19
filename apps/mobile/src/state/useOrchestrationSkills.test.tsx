import { EnvironmentId, type OrchestrationSkillsStatus } from "@supaterm/contracts";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useOrchestrationSkills } from "./useOrchestrationSkills";

const testState = vi.hoisted(() => ({
  permissions: new Set<string>(),
  statuses: new Map<string, unknown>(),
  commandCalls: [] as Array<{ action: string; environmentId: string }>,
  revokeDuringAction: null as string | null,
}));

vi.mock("./session", () => ({
  useEnvironmentsWithScope: (environments: ReadonlyArray<{ environmentId: string }>) =>
    new Set(
      environments.flatMap(({ environmentId }) => {
        const id = String(environmentId);
        return testState.permissions.has(id) ? [id] : [];
      }),
    ),
  readEnvironmentScope: (environmentId: string) => testState.permissions.has(String(environmentId)),
}));

vi.mock("./use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));

const local = { label: "Local", environmentId: EnvironmentId.make("local") };
const remote = { label: "Remote", environmentId: EnvironmentId.make("remote") };
const selected = [local, remote];

function skillsStatus(installed: boolean): OrchestrationSkillsStatus {
  return {
    targets: [
      {
        directory: "/skills",
        providers: ["Claude"],
        skills: [
          {
            name: "supaterm-advisor",
            state: installed ? "installed" : "not-installed",
            managed: installed,
          },
        ],
      },
    ],
    unsupportedProviders: [],
  };
}

const installedStatus = skillsStatus(true);

function makeCommand(action: "Status" | "Install" | "Uninstall") {
  return vi.fn(
    async ({
      environmentId,
    }: {
      environmentId: EnvironmentId;
    }): Promise<
      { _tag: "Success"; value: OrchestrationSkillsStatus } | { _tag: "Failure"; error: Error }
    > => {
      const key = String(environmentId);
      testState.commandCalls.push({ action, environmentId: key });
      if (testState.revokeDuringAction === action) {
        testState.revokeDuringAction = null;
        testState.permissions.delete(key);
        return { _tag: "Failure", error: new Error("Permission revoked") };
      }
      const value = action === "Status" ? testState.statuses.get(key) : installedStatus;
      if (value === undefined) throw new Error(`Missing status for ${key}`);
      return { _tag: "Success", value: value as OrchestrationSkillsStatus };
    },
  );
}

let statusCommand: ReturnType<typeof makeCommand>;
let installCommand: ReturnType<typeof makeCommand>;
let uninstallCommand: ReturnType<typeof makeCommand>;
let commands: Parameters<typeof useOrchestrationSkills>[1];
let renderer: ReactTestRenderer | undefined;
const latest: { current: ReturnType<typeof useOrchestrationSkills> | undefined } = {
  current: undefined,
};
let resolveInitialStatus: (() => void) | undefined;

function Probe() {
  const skills = useOrchestrationSkills(selected, commands);
  useLayoutEffect(() => {
    latest.current = skills;
    if (skills.pending === null) resolveInitialStatus?.();
  }, [skills]);
  return null;
}

function current() {
  return latest.current!;
}

async function mount() {
  const initialStatus = new Promise<void>((resolve) => {
    resolveInitialStatus = resolve;
  });
  await act(() => {
    renderer = create(<Probe />);
  });
  await act(async () => initialStatus);
  resolveInitialStatus = undefined;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  testState.permissions.clear();
  testState.statuses.clear();
  testState.commandCalls.length = 0;
  testState.revokeDuringAction = null;
  latest.current = undefined;
  statusCommand = makeCommand("Status");
  installCommand = makeCommand("Install");
  uninstallCommand = makeCommand("Uninstall");
  commands = {
    orchestrationSkillsStatus: statusCommand,
    orchestrationSkillsInstall: installCommand,
    orchestrationSkillsUninstall: uninstallCommand,
  } as unknown as Parameters<typeof useOrchestrationSkills>[1];
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("orchestration skill permissions", () => {
  it("runs only on permitted environments and preserves denied environments' status", async () => {
    testState.permissions.add(String(local.environmentId));
    testState.statuses.set(String(local.environmentId), skillsStatus(false));
    testState.statuses.set(String(remote.environmentId), installedStatus);
    await mount();
    testState.commandCalls.length = 0;

    expect(current().canInstall).toBe(true);
    expect(current().canUninstall).toBe(false);
    await act(async () => current().request("Install"));

    expect(installCommand).toHaveBeenCalledTimes(1);
    expect(installCommand).toHaveBeenCalledWith({
      environmentId: local.environmentId,
      input: {},
    });
    expect(testState.commandCalls).toEqual([{ action: "Install", environmentId: "local" }]);
    expect(current().installed).toBe(true);
    expect(current().error).toBe(false);
    expect(current().notices).toContain(
      "Remote: This connection does not have permission to manage provider skills.",
    );
  });

  it("rechecks a revoked grant before dispatch and retains the last known status", async () => {
    testState.permissions.add(String(local.environmentId));
    testState.statuses.set(String(local.environmentId), installedStatus);
    testState.statuses.set(String(remote.environmentId), installedStatus);
    await mount();
    expect(current().canUninstall).toBe(true);
    const staleRequest = current().request;
    testState.commandCalls.length = 0;
    testState.permissions.delete(String(local.environmentId));

    await act(async () => staleRequest("Uninstall"));

    expect(uninstallCommand).not.toHaveBeenCalled();
    expect(current().installed).toBe(true);
    expect(current().error).toBe(false);

    await act(() => renderer?.update(<Probe />));
    expect(current().canUninstall).toBe(false);
    expect(current().notices).toContain(
      "Local: This connection does not have permission to manage provider skills.",
    );
  });

  it("retains the last known status when authorization fails after a grant is revoked", async () => {
    testState.permissions.add(String(local.environmentId));
    testState.statuses.set(String(local.environmentId), installedStatus);
    testState.statuses.set(String(remote.environmentId), installedStatus);
    await mount();
    testState.revokeDuringAction = "Uninstall";

    await act(async () => current().request("Uninstall"));

    expect(uninstallCommand).toHaveBeenCalledTimes(1);
    expect(current().installed).toBe(true);
    expect(current().error).toBe(false);
    expect(current().canUninstall).toBe(false);
    expect(current().notices).toContain(
      "Local: This connection does not have permission to manage provider skills.",
    );
  });
});
