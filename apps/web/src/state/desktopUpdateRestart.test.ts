import type { DesktopUpdateActionResult, DesktopUpdateState } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createDesktopUpdateRestartController } from "./desktopUpdateRestart";

const downloadedState: DesktopUpdateState = {
  enabled: true,
  status: "downloaded",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: "1.1.0",
  downloadedVersion: "1.1.0",
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: 100,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

const acceptedInstall: DesktopUpdateActionResult = {
  accepted: true,
  completed: false,
  state: downloadedState,
};

describe("desktop update restart", () => {
  it("shows feedback before invoking the installer and retains it until the app closes", async () => {
    const controller = createDesktopUpdateRestartController();
    const installUpdate = vi.fn(async () => {
      expect(controller.store.getState().isRestarting).toBe(true);
      return acceptedInstall;
    });

    const install = controller.install({ installUpdate });
    expect(controller.store.getState().isRestarting).toBe(true);
    await install;

    expect(controller.store.getState().isRestarting).toBe(true);
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  it("shares a restart request across entry points, including after acceptance", async () => {
    const controller = createDesktopUpdateRestartController();
    const installUpdate = vi.fn(async () => acceptedInstall);
    const bridge = { installUpdate };

    const install = controller.install(bridge);
    expect(controller.install(bridge)).toBe(install);
    await install;
    expect(controller.install(bridge)).toBe(install);
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  it("restores the app when installation is refused", async () => {
    const controller = createDesktopUpdateRestartController();

    await expect(
      controller.install({
        installUpdate: async () => ({ ...acceptedInstall, accepted: false }),
      }),
    ).rejects.toThrow("The update could not start. Try again.");

    expect(controller.store.getState().isRestarting).toBe(false);
  });

  it.each(["downloaded", "error"] as const)(
    "restores the app when an accepted install fails with %s state",
    async (status) => {
      const controller = createDesktopUpdateRestartController();

      await expect(
        controller.install({
          installUpdate: async () => ({
            ...acceptedInstall,
            state: {
              ...downloadedState,
              status,
              errorContext: "install",
              message: "Could not launch the installer.",
            },
          }),
        }),
      ).rejects.toThrow("Could not launch the installer.");

      expect(controller.store.getState().isRestarting).toBe(false);
    },
  );

  it("allows another restart after a rejected request", async () => {
    const controller = createDesktopUpdateRestartController();
    const error = new Error("IPC unavailable");
    const outcomes: Array<() => Promise<DesktopUpdateActionResult>> = [
      () => Promise.reject(error),
      () => Promise.resolve(acceptedInstall),
    ];
    let installs = 0;
    const installUpdate = () => {
      installs += 1;
      return outcomes.shift()!();
    };

    await expect(controller.install({ installUpdate })).rejects.toBe(error);
    expect(controller.store.getState().isRestarting).toBe(false);

    await controller.install({ installUpdate });
    expect(controller.store.getState().isRestarting).toBe(true);
    expect(installs).toBe(2);
  });
});
