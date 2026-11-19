import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  confirmTerminalClose as confirmWithHost,
  isTerminalCloseConfirmPending,
  type CloseConfirmationHost,
  type TerminalCloseTarget,
} from "./terminalCloseConfirm";

const confirmMock = vi.fn<(message: string, options?: unknown) => void>();
const settingsMock = { confirmTerminalClose: true };
const dialogs = {
  available: true,
  answer: () => Promise.resolve(false),
  hydrate: () => Promise.resolve(),
};
const host: CloseConfirmationHost = {
  dialogs: () =>
    dialogs.available
      ? {
          confirm: (message, options) => {
            confirmMock(message, options);
            return dialogs.answer();
          },
        }
      : undefined,
  hydrateSettings: () => dialogs.hydrate(),
  confirmTerminalCloseEnabled: () => settingsMock.confirmTerminalClose,
};
const confirmTerminalClose = (targets: readonly TerminalCloseTarget[]) =>
  confirmWithHost(targets, host);

const target = (label: string, hasRunningSubprocess = true) => ({
  label,
  hasRunningSubprocess,
});

describe("terminal close confirmation", () => {
  beforeEach(() => {
    settingsMock.confirmTerminalClose = true;
    dialogs.available = true;
    dialogs.answer = () => Promise.resolve(false);
    dialogs.hydrate = () => Promise.resolve();
    confirmMock.mockReset();
  });

  it("closes single and multiple terminals immediately when confirmation is disabled", async () => {
    settingsMock.confirmTerminalClose = false;

    await expect(confirmTerminalClose([target("Terminal 1")])).resolves.toBe(true);
    await expect(confirmTerminalClose([target("Terminal 1"), target("Terminal 2")])).resolves.toBe(
      true,
    );
    expect(confirmMock).not.toHaveBeenCalled();
    expect(isTerminalCloseConfirmPending()).toBe(false);

    settingsMock.confirmTerminalClose = true;
    dialogs.answer = () => Promise.resolve(false);
    await expect(confirmTerminalClose([target("Terminal 1")])).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledOnce();
  });

  it("waits for the saved opt-out before closing immediately after reload", async () => {
    let finishHydration: () => void = () => undefined;
    dialogs.hydrate = () =>
      new Promise<void>((resolve) => {
        finishHydration = () => {
          settingsMock.confirmTerminalClose = false;
          resolve();
        };
      });

    const close = confirmTerminalClose([target("Terminal 1")]);
    expect(isTerminalCloseConfirmPending()).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();

    finishHydration();
    await expect(close).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(isTerminalCloseConfirmPending()).toBe(false);
  });

  it("asks for confirmation when saved settings cannot be loaded", async () => {
    settingsMock.confirmTerminalClose = false;
    dialogs.hydrate = () => Promise.reject(new Error("storage unavailable"));
    dialogs.answer = () => Promise.resolve(false);

    await expect(confirmTerminalClose([target("Terminal 1")])).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(isTerminalCloseConfirmPending()).toBe(false);
  });

  it("tracks pending state until the confirmation settles", async () => {
    let settle: (value: boolean) => void = () => undefined;
    const asked = new Promise<void>((resolveAsked) => {
      dialogs.answer = () => {
        resolveAsked();
        return new Promise<boolean>((resolve) => (settle = resolve));
      };
    });

    expect(isTerminalCloseConfirmPending()).toBe(false);

    const confirmation = confirmTerminalClose([target("Terminal 1")]);
    expect(isTerminalCloseConfirmPending()).toBe(true);

    await asked;
    expect(isTerminalCloseConfirmPending()).toBe(true);
    settle(true);
    await expect(confirmation).resolves.toBe(true);
    expect(isTerminalCloseConfirmPending()).toBe(false);
  });

  it("clears pending state and resolves false when the dialog rejects", async () => {
    let reject: (reason?: unknown) => void = () => undefined;
    const asked = new Promise<void>((resolveAsked) => {
      dialogs.answer = () => {
        resolveAsked();
        return new Promise<boolean>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        });
      };
    });

    const confirmation = confirmTerminalClose([target("Terminal 1")]);
    expect(isTerminalCloseConfirmPending()).toBe(true);

    await asked;
    reject(new Error("dialog failed"));
    await expect(confirmation).resolves.toBe(false);
    expect(isTerminalCloseConfirmPending()).toBe(false);
  });

  it("names every terminal in a multi-terminal close", async () => {
    dialogs.answer = () => Promise.resolve(true);

    await expect(
      confirmTerminalClose([target("Terminal 1"), target("Development server")]),
    ).resolves.toBe(true);
    expect(confirmMock).toHaveBeenCalledWith(
      [
        "Close 2 terminals?",
        'This stops their running processes and clears their histories: "Terminal 1", "Development server".',
      ].join("\n"),
      { variant: "destructive" },
    );
  });

  it("closes without prompting when all terminals are idle", async () => {
    await expect(confirmTerminalClose([target("Terminal 1", false)])).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("only names running terminals in a mixed close", async () => {
    dialogs.answer = () => Promise.resolve(true);

    await expect(
      confirmTerminalClose([target("Terminal 1", false), target("Development server")]),
    ).resolves.toBe(true);
    expect(confirmMock).toHaveBeenCalledWith(
      [
        'Close terminal "Development server"?',
        "This stops the running process and clears its history.",
      ].join("\n"),
      { variant: "destructive" },
    );
  });

  it("closes without prompting when no local API is available", async () => {
    dialogs.available = false;

    await expect(confirmTerminalClose([target("Terminal 1")])).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
