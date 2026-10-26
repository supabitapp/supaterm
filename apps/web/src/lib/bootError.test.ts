import type { DesktopBridge, DesktopCliCommandState } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { resolveTriageCommand } from "./bootError";

const desktopWith = (getState: () => Promise<DesktopCliCommandState>) =>
  ({ cliCommand: { getState } }) as unknown as DesktopBridge;

const notOnPath = (launcherPath: string | null): DesktopCliCommandState => ({
  supported: launcherPath !== null,
  installedPath: null,
  onPath: false,
  launcherPath,
});

describe("resolveTriageCommand", () => {
  it("prefers supaterm on PATH, then the desktop launcher", async () => {
    const onPath = { ...notOnPath("/home/me/.supaterm/bin/supaterm"), onPath: true };
    await expect(resolveTriageCommand(desktopWith(async () => onPath))).resolves.toBe(
      "supaterm triage",
    );
    await expect(
      resolveTriageCommand(desktopWith(async () => notOnPath("/home/me/.supaterm/bin/supaterm"))),
    ).resolves.toBe("/home/me/.supaterm/bin/supaterm triage");
  });

  it("quotes launcher paths for the shell that runs them", async () => {
    await expect(
      resolveTriageCommand(
        desktopWith(async () => notOnPath("/Users/O'Neil/.supaterm/bin/supaterm")),
      ),
    ).resolves.toBe(`'/Users/O'"'"'Neil/.supaterm/bin/supaterm' triage`);
    await expect(
      resolveTriageCommand(
        desktopWith(async () => notOnPath("C:\\Users\\Me\\.supaterm\\bin\\supaterm.cmd")),
      ),
    ).resolves.toBe("C:\\Users\\Me\\.supaterm\\bin\\supaterm.cmd triage");
    await expect(
      resolveTriageCommand(
        desktopWith(async () => notOnPath("C:\\Users\\Jo O'Neil\\.supaterm\\bin\\supaterm.cmd")),
      ),
    ).resolves.toBe("& 'C:\\Users\\Jo O''Neil\\.supaterm\\bin\\supaterm.cmd' triage");
  });

  it("falls back to npx without a usable desktop launcher", async () => {
    using _warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(resolveTriageCommand(undefined)).resolves.toBe("npx supaterm triage");
    await expect(resolveTriageCommand({} as DesktopBridge)).resolves.toBe("npx supaterm triage");
    await expect(resolveTriageCommand(desktopWith(async () => notOnPath(null)))).resolves.toBe(
      "npx supaterm triage",
    );
    const staleWindowsPathEntry = { ...notOnPath(null), supported: true, onPath: true };
    await expect(
      resolveTriageCommand(desktopWith(async () => staleWindowsPathEntry)),
    ).resolves.toBe("npx supaterm triage");
    await expect(
      resolveTriageCommand(desktopWith(() => Promise.reject(new Error("ipc closed")))),
    ).resolves.toBe("npx supaterm triage");
  });
});
