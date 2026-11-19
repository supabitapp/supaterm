import * as NodeEvents from "node:events";

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

class FakeConsoleStream extends NodeEvents.EventEmitter {
  readonly isTTY = true;
  readonly _readableState = { reading: true };
  _handle: { reading: boolean; readStop: () => void } | undefined = {
    reading: true,
    readStop: vi.fn(),
  };
}

function consoleIo(
  overrides: {
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
    readonly fstat?: (fd: number) => { isCharacterDevice(): boolean };
    readonly isatty?: (fd: number) => boolean;
    readonly open?: (path: string) => number;
  } = {},
) {
  const opened: Array<string> = [];
  const closed: Array<number> = [];
  const replaced: Array<FakeConsoleStream> = [];
  const open = overrides.open ?? (() => 42);
  const io = {
    platform: overrides.platform ?? "win32",
    env: overrides.env ?? { SUPATERM_DESKTOP_CLI_LAUNCHER: "1" },
    fstat: overrides.fstat ?? (() => ({ isCharacterDevice: () => true })),
    isatty: overrides.isatty ?? ((fd: number) => fd !== 0),
    open: (path: string) => {
      opened.push(path);
      return open(path);
    },
    close: (fd: number) => {
      closed.push(fd);
    },
    openReadStream: () => new FakeConsoleStream(),
    replaceStdin: (stdin: NodeEvents.EventEmitter) => {
      if (stdin instanceof FakeConsoleStream) replaced.push(stdin);
    },
  };
  return { io, opened, closed, replaced };
}

beforeEach(() => {
  vi.resetModules();
});

describe("attachConsoleStdin", () => {
  it("reopens the console when Node replaces missing Windows stdin with NUL", async () => {
    const { attachConsoleStdin, interactiveStdin } = await import("./consoleStdin.ts");
    const { io, replaced } = consoleIo();

    expect(attachConsoleStdin(io)).toBe(42);
    expect(replaced.at(-1)?.isTTY).toBe(true);
    expect(interactiveStdin()).toBe(42);
    expect(io.env.SUPATERM_DESKTOP_CLI_LAUNCHER).toBeUndefined();
  });

  it("releases console reads when the picker pauses stdin before launching an agent", async () => {
    const { attachConsoleStdin, interactiveStdin } = await import("./consoleStdin.ts");
    const { io, replaced } = consoleIo();
    attachConsoleStdin(io);
    const stdin = replaced.at(-1)!;
    const handle = stdin._handle!;
    stdin.emit("pause");
    expect(stdin._readableState.reading).toBe(false);
    expect(handle.reading).toBe(false);
    expect(handle.readStop).toHaveBeenCalledOnce();
    expect(interactiveStdin()).toBe(42);
  });

  it("can pause after the reopened stream's handle has been closed", async () => {
    const { attachConsoleStdin } = await import("./consoleStdin.ts");
    const { io, replaced } = consoleIo();
    attachConsoleStdin(io);
    const stdin = replaced.at(-1)!;
    stdin._handle = undefined;
    expect(() => stdin.emit("pause")).not.toThrow();
  });

  it("still reopens a closed stdin", async () => {
    const { attachConsoleStdin, interactiveStdin } = await import("./consoleStdin.ts");
    const { io } = consoleIo({
      fstat: () => {
        throw new Error("EBADF");
      },
    });
    expect(attachConsoleStdin(io)).toBe(42);
    expect(interactiveStdin()).toBe(42);
  });

  it.each(["pipe"])("preserves redirected %s input", async () => {
    const { attachConsoleStdin, interactiveStdin } = await import("./consoleStdin.ts");
    const { io, opened, replaced } = consoleIo({
      fstat: () => ({ isCharacterDevice: () => false }),
    });
    expect(attachConsoleStdin(io)).toBeUndefined();
    expect(replaced).toEqual([]);
    expect(interactiveStdin()).toBe("inherit");
    expect(opened).toEqual([]);
  });

  it.each(["console input", "redirected output", "unmarked process", "non-Windows"])(
    "leaves %s alone",
    async (scenario) => {
      const { attachConsoleStdin, interactiveStdin } = await import("./consoleStdin.ts");
      const { io, opened } = consoleIo({
        ...(scenario === "console input" ? { isatty: () => true } : {}),
        ...(scenario === "redirected output" ? { isatty: () => false } : {}),
        ...(scenario === "unmarked process" ? { env: {} } : {}),
        ...(scenario === "non-Windows" ? { platform: "darwin" } : {}),
      });
      expect(attachConsoleStdin(io)).toBeUndefined();
      expect(interactiveStdin()).toBe("inherit");
      expect(opened).toEqual([]);
      expect(io.env.SUPATERM_DESKTOP_CLI_LAUNCHER).toBeUndefined();
    },
  );

  it("keeps inherited input when CONIN$ cannot be opened", async () => {
    const { attachConsoleStdin, interactiveStdin } = await import("./consoleStdin.ts");
    const { io } = consoleIo({
      open: () => {
        throw new Error("ENOENT");
      },
    });
    expect(attachConsoleStdin(io)).toBeUndefined();
    expect(interactiveStdin()).toBe("inherit");
  });

  it("closes a reopened descriptor that is not a console", async () => {
    const { attachConsoleStdin, interactiveStdin } = await import("./consoleStdin.ts");
    const { io, closed } = consoleIo({ isatty: (fd) => fd === 1 });
    expect(attachConsoleStdin(io)).toBeUndefined();
    expect(interactiveStdin()).toBe("inherit");
    expect(closed).toEqual([42]);
  });
});
