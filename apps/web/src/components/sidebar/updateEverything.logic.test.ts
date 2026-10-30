import {
  EnvironmentId,
  type ServerSelfUpdateCapability,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  awaitsTrackSwitch,
  collectChannelSwitchTargets,
  collectRestartingMachines,
  localSwitchBlockReason,
  collectServerUpdateTargets,
  describeUpdateEverything,
  runUpdateEverything,
  type UpdateEverythingMachine,
} from "./updateEverything.logic";

function machine(
  id: string,
  serverVersion: string,
  selfUpdate: ServerSelfUpdateCapability | undefined,
  overrides: Partial<UpdateEverythingMachine> = {},
): UpdateEverythingMachine {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    serverConfig: {
      environment: {
        environmentId: EnvironmentId.make(id),
        label: id,
        platform: { os: "linux", arch: "x64" },
        serverVersion,
        orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
        capabilities: {
          ...(selfUpdate ? { serverSelfUpdate: selfUpdate } : {}),
          ...(selfUpdate === "desktop-managed"
            ? { desktopAppUpdate: true, desktopAppChannelSwitch: true }
            : {}),
        },
      },
      settings: { continueThreadsAfterServerUpdate: false },
    },
    connected: true,
    hostedByThisApp: false,
    canMaintain: true,
    updateState: { status: "idle" },
    ...overrides,
  };
}

describe("collectServerUpdateTargets", () => {
  it("updates remote servers that can move to the target and names every skipped one", () => {
    const { targets, skipped } = collectServerUpdateTargets(
      [
        machine("this-app", "0.0.40", "desktop-managed", { hostedByThisApp: true }),
        machine("service", "0.0.40", "boot-service"),
        machine("nightly-service", "0.0.49-nightly.20261001.3", "boot-service"),
        machine("other-desktop", "0.0.49-nightly.20261001.3", "desktop-managed"),
        machine("offline", "0.0.40", "boot-service", { connected: false }),
        machine("never-connected", "0.0.40", "boot-service", { serverConfig: null }),
        machine("no-scope", "0.0.40", "boot-service", { canMaintain: false }),
        machine("busy", "0.0.40", "boot-service", {
          updateState: {
            status: "running",
            stage: "downloading",
            fromVersion: "0.0.40",
            targetVersion: "0.0.50",
          },
        }),
        machine("current", "0.0.50", "boot-service"),
        machine("current-offline", "0.0.50", "boot-service", { connected: false }),
        machine("manual", "0.0.40", undefined),
      ],
      "0.0.50",
    );

    expect(targets.map((target) => [target.serverLabel, target.targetVersion])).toEqual([
      ["service", "0.0.50"],
      ["other-desktop", "0.0.50"],
    ]);
    expect(skipped.map((entry) => [entry.label, entry.reason])).toEqual([
      ["nightly-service", "on the nightly channel"],
      ["offline", "not connected"],
      ["never-connected", "not connected"],
      ["no-scope", "no permission"],
      ["busy", "already updating"],
      ["manual", "needs a manual update"],
    ]);
  });
});

describe("collectChannelSwitchTargets", () => {
  it("does not equate migration numbers with database compatibility across tracks", () => {
    const release = { channel: "latest" as const, version: "0.1.3" };
    const { targets, skipped } = collectChannelSwitchTargets(
      [
        machine("nightly", "0.1.2-nightly.20261020.1200", "boot-service"),
        machine("stable", "0.1.2", "boot-service"),
      ],
      release,
    );
    expect(targets.map((target) => target.serverLabel)).toEqual(["stable"]);
    expect(skipped).toEqual([
      {
        environmentId: EnvironmentId.make("nightly"),
        label: "nightly",
        reason:
          "database compatibility for this release has not been verified; switch this machine manually",
      },
    ]);
  });
});

describe("localSwitchBlockReason", () => {
  it("requires every hosted backend to connect and then requires compatibility proof", () => {
    const release = { channel: "latest" as const, version: "0.1.3" };
    const nightly = "0.1.4-nightly.20261027.3796";
    expect(localSwitchBlockReason(nightly, release, [{ connected: true }], 1)).toContain(
      "has not been verified",
    );
    expect(localSwitchBlockReason(nightly, release, [{ connected: true }], 2)).toContain(
      "not connected",
    );
    expect(localSwitchBlockReason(nightly, release, [{ connected: false }], 1)).toContain(
      "not connected",
    );
    expect(localSwitchBlockReason("0.1.3", release, [], 1)).toBeNull();
  });
});

describe("collectRestartingMachines", () => {
  it("lists updated servers, and this app's servers only when it installs", () => {
    const withContinuation = (
      id: string,
      overrides: Partial<UpdateEverythingMachine> = {},
      enabled = false,
    ) => {
      const base = machine(id, "0.0.40", "boot-service", overrides);
      return {
        ...base,
        serverConfig: {
          environment: {
            ...base.serverConfig!.environment,
            capabilities: {
              ...base.serverConfig!.environment.capabilities,
            },
          },
          settings: { continueThreadsAfterServerUpdate: enabled },
        },
      };
    };
    const machines = [
      withContinuation("this-app", { hostedByThisApp: true }, true),
      withContinuation("alvin", {}, true),
      withContinuation("opted-out", {}, false),
      machine("old", "0.0.40", "boot-service"),
      withContinuation("providers-only"),
    ];
    const servers = ["alvin", "opted-out", "old"].map((id) => ({
      environmentId: EnvironmentId.make(id),
    }));

    expect(collectRestartingMachines(machines, servers, true)).toEqual([
      { environmentId: "this-app", continuesThreads: true },
      { environmentId: "alvin", continuesThreads: true },
      { environmentId: "opted-out", continuesThreads: false },
      { environmentId: "old", continuesThreads: false },
    ]);
    expect(
      collectRestartingMachines(machines, servers, false).map((entry) => entry.environmentId),
    ).toEqual(["alvin", "opted-out", "old"]);
  });
});

describe("runUpdateEverything", () => {
  it("still updates remote machines when the local download fails", async () => {
    const calls: string[] = [];
    const result = await runUpdateEverything({
      downloadLocal: async () => false,
      updateProviders: async () => {
        calls.push("providers");
      },
      updateServers: async () => {
        calls.push("servers");
      },
    });

    expect(calls).toEqual(["providers", "servers"]);
    expect(result.localReady).toBe(false);
  });
});

describe("describeUpdateEverything", () => {
  it("gives each machine one row with its Supaterm and provider updates", () => {
    const id = EnvironmentId.make;
    const { rows } = describeUpdateEverything({
      localVersion: "1.1.0",
      localMachines: [
        { environmentId: id("local"), label: "Mainbook" },
        { environmentId: id("wsl"), label: "Mainbook WSL" },
      ],
      servers: [
        {
          environmentId: id("npm"),
          serverLabel: "bb-1",
          selfUpdate: "boot-service",
          targetVersion: "1.1.0",
        },
      ],
      providerMachines: [
        { environmentId: id("npm"), label: "bb-1", providers: ["Codex", "Claude"] },
        { environmentId: id("local"), label: "Mainbook", providers: ["Codex"] },
        { environmentId: id("manual"), label: "alvin", providers: ["Claude"] },
      ],
      skipped: [
        { environmentId: id("manual"), label: "alvin", reason: "needs a manual update" },
        { environmentId: id("offline"), label: "TheoRoom", reason: "not connected" },
      ],
    });

    expect(
      rows.map(({ label, app, skipped, providers }) => [label, app, skipped, providers]),
    ).toEqual([
      ["Mainbook", "this-app", null, ["Codex"]],
      ["Mainbook WSL", "this-app", null, []],
      ["bb-1", "server", null, ["Codex", "Claude"]],
      ["alvin", null, "needs a manual update", ["Claude"]],
      ["TheoRoom", null, "not connected", []],
    ]);
  });
});

describe("partial track switch review", () => {
  it("retains off-track hosts for review while compatibility still blocks their update", () => {
    const offTrack = machine("remote", "0.0.49", "boot-service");
    const alreadySwitched = machine("current", "0.0.50-nightly.20261029.1", "boot-service");
    const hosted = machine("hosted", "0.0.49", "desktop-managed", { hostedByThisApp: true });
    const manual = machine("manual", "0.0.49", undefined);
    expect(
      [offTrack, alreadySwitched, hosted, manual].flatMap((entry) =>
        awaitsTrackSwitch(entry, "nightly") ? [entry.label] : [],
      ),
    ).toEqual(["remote"]);
    const plan = collectChannelSwitchTargets([offTrack], {
      channel: "nightly",
      version: "0.0.50-nightly.20261029.1",
    });
    expect(plan.targets).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("database compatibility");
  });
});
