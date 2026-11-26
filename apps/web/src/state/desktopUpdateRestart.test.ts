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

const onUpdateState = () => () => {};

function acceptingInstaller(onCall: () => void = () => {}) {
  let reached!: () => void;
  const called = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const installUpdate = vi.fn(async () => {
    onCall();
    reached();
    return acceptedInstall;
  });
  return { installUpdate, called };
}

describe("desktop update restart", () => {
  it("shows feedback before invoking the installer and retains it until the app closes", async () => {
    const controller = createDesktopUpdateRestartController();
    const { installUpdate, called } = acceptingInstaller(() =>
      expect(controller.store.getState().isRestarting).toBe(true),
    );

    void controller.install({ installUpdate, onUpdateState });
    expect(controller.store.getState().isRestarting).toBe(true);
    await called;

    expect(controller.store.getState().isRestarting).toBe(true);
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  it("shares a restart request across entry points, including after acceptance", async () => {
    const controller = createDesktopUpdateRestartController();
    const { installUpdate, called } = acceptingInstaller();
    const bridge = { installUpdate, onUpdateState };

    const install = controller.install(bridge);
    expect(controller.install(bridge)).toBe(install);
    await called;
    expect(controller.install(bridge)).toBe(install);
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  it("restores the app when installation is refused", async () => {
    const controller = createDesktopUpdateRestartController();

    await expect(
      controller.install({
        installUpdate: async () => ({ ...acceptedInstall, accepted: false }),
        onUpdateState,
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
          onUpdateState,
        }),
      ).rejects.toThrow("Could not launch the installer.");

      expect(controller.store.getState().isRestarting).toBe(false);
    },
  );

  it("allows another restart after a rejected request", async () => {
    const controller = createDesktopUpdateRestartController();
    const error = new Error("IPC unavailable");
    const failing = vi.fn<() => Promise<DesktopUpdateActionResult>>().mockRejectedValueOnce(error);

    await expect(controller.install({ installUpdate: failing, onUpdateState })).rejects.toBe(error);
    expect(controller.store.getState().isRestarting).toBe(false);

    const { installUpdate, called } = acceptingInstaller();
    void controller.install({ installUpdate, onUpdateState });
    await called;
    expect(controller.store.getState().isRestarting).toBe(true);
    expect(installUpdate).toHaveBeenCalledOnce();
  });
});
