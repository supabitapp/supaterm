import { getTerminalLabel } from "@supaterm/shared/terminalLabels";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { RightPanelSurface } from "../rightPanelStore";

import {
  agentControlledBrowserCloseConfirmation,
  confirmRightPanelSurfacesClose,
} from "./rightPanelCloseConfirm";
import type { CloseConfirmationHost } from "./terminalCloseConfirm";

const confirmMock = vi.fn<(message: string, options?: unknown) => void>();
const answers: Array<boolean> = [];
const host: CloseConfirmationHost = {
  dialogs: () => ({
    confirm: async (message, options) => {
      confirmMock(message, options);
      return answers.length > 1 ? answers.shift()! : (answers[0] ?? false);
    },
  }),
  hydrateSettings: async () => {},
  confirmTerminalCloseEnabled: () => true,
};

describe("agent browser close confirmation", () => {
  const surfaces = [
    { id: "browser:one", kind: "preview", resourceId: "tab-1" },
    { id: "browser:two", kind: "preview", resourceId: "tab-2" },
    { id: "diff", kind: "diff" },
  ] satisfies RightPanelSurface[];

  it("only warns for browsers under active agent control", () => {
    expect(
      agentControlledBrowserCloseConfirmation(surfaces, {
        "tab-1": { controller: "none" },
        "tab-2": { controller: "human" },
      }),
    ).toBeNull();

    expect(
      agentControlledBrowserCloseConfirmation([surfaces[0]!], {
        "tab-1": { controller: "agent" },
      }),
    ).toBe(
      [
        "Close browser while the agent is using it?",
        "The agent is actively controlling this browser. Closing it may interrupt the current browser action.",
      ].join("\n"),
    );
  });

  it("counts every agent-controlled browser in a bulk close", () => {
    expect(
      agentControlledBrowserCloseConfirmation(surfaces, {
        "tab-1": { controller: "agent" },
        "tab-2": { controller: "agent" },
      }),
    ).toContain("Close 2 browsers");
  });
});

describe("right panel bulk close confirmation", () => {
  const surfaces = [
    {
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-1",
    },
    {
      id: "terminal:term-3",
      kind: "terminal",
      resourceId: "term-3",
      terminalIds: ["term-3"],
      activeTerminalId: "term-3",
    },
    { id: "browser:one", kind: "preview", resourceId: "tab-1" },
    { id: "diff", kind: "diff" },
  ] satisfies RightPanelSurface[];

  const terminalCloseTarget = (runningTerminalIds: readonly string[]) => (terminalId: string) => ({
    label: getTerminalLabel(terminalId),
    hasRunningSubprocess: runningTerminalIds.includes(terminalId),
  });

  beforeEach(() => {
    confirmMock.mockReset();
    answers.length = 0;
  });

  it("asks once, naming only the running terminals across every closed tab", async () => {
    answers.push(false);

    await expect(
      confirmRightPanelSurfacesClose(surfaces, {
        desktopByTabId: {},
        host,
        terminalCloseTarget: terminalCloseTarget(["term-1", "term-3"]),
      }),
    ).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    const message = confirmMock.mock.calls[0]?.[0];
    expect(message).toContain('"Terminal 1"');
    expect(message).toContain('"Terminal 3"');
    expect(message).not.toContain('"Terminal 2"');
  });

  it("closes idle terminals without asking", async () => {
    await expect(
      confirmRightPanelSurfacesClose(surfaces, {
        desktopByTabId: {},
        host,
        terminalCloseTarget: terminalCloseTarget([]),
      }),
    ).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("asks about running terminals after the agent's browser close is accepted", async () => {
    answers.push(true, false);

    await expect(
      confirmRightPanelSurfacesClose(surfaces, {
        desktopByTabId: { "tab-1": { controller: "agent" } },
        host,
        terminalCloseTarget: terminalCloseTarget(["term-1"]),
      }),
    ).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(confirmMock.mock.calls[0]?.[0]).toContain("Close browser while the agent is using it?");
    expect(confirmMock.mock.calls[1]?.[0]).toContain('"Terminal 1"');
  });

  it("skips the terminal prompt when closing the agent's browser is declined", async () => {
    answers.push(false);

    await expect(
      confirmRightPanelSurfacesClose(surfaces, {
        desktopByTabId: { "tab-1": { controller: "agent" } },
        host,
        terminalCloseTarget: terminalCloseTarget(["term-1"]),
      }),
    ).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});
