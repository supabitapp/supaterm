// @effect-diagnostics nodeBuiltinImport:off - Runs before the Effect runtime starts, on raw file descriptors.
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeTty from "node:tty";

import * as HostProcess from "@supaterm/shared/HostProcess";

function needsConsoleStdin(input: {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly stdinMissing: boolean;
  readonly stdoutIsConsole: boolean;
}): boolean {
  return (
    input.platform === "win32" &&
    input.env.SUPATERM_DESKTOP_CLI_LAUNCHER === "1" &&
    input.stdinMissing &&
    input.stdoutIsConsole
  );
}

interface ConsoleIo {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly fstat: (fd: number) => { isCharacterDevice(): boolean };
  readonly isatty: (fd: number) => boolean;
  readonly open: (path: string) => number;
  readonly close: (fd: number) => void;
  readonly openReadStream: (fd: number) => NodeEvents.EventEmitter;
  readonly replaceStdin: (stdin: NodeEvents.EventEmitter) => void;
}

const nodeConsoleIo = (): ConsoleIo => ({
  platform: HostProcess.Platform.defaultValue(),
  env: process.env,
  fstat: NodeFS.fstatSync,
  isatty: NodeTty.isatty,
  open: (path) => NodeFS.openSync(path, "r+"),
  close: NodeFS.closeSync,
  openReadStream: (fd) => new NodeTty.ReadStream(fd),
  replaceStdin: (stdin) =>
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true, enumerable: true }),
});

const isMissingInput = (io: ConsoleIo, fd: number) => {
  try {
    return io.fstat(fd).isCharacterDevice() && !io.isatty(fd);
  } catch {
    return true;
  }
};

/** Call before reading process.stdin. Returns the reopened fd for children, or undefined without changing stdin. */
export function attachConsoleStdin(io = nodeConsoleIo()): number | undefined {
  const needed = needsConsoleStdin({
    platform: io.platform,
    env: io.env,
    stdinMissing: isMissingInput(io, 0),
    stdoutIsConsole: io.isatty(1),
  });
  delete io.env.SUPATERM_DESKTOP_CLI_LAUNCHER;
  if (!needed) return undefined;
  let fd: number;
  try {
    fd = io.open("\\\\.\\CONIN$");
  } catch {
    return undefined;
  }
  if (!io.isatty(fd)) {
    io.close(fd);
    return undefined;
  }
  const stdin = io.openReadStream(fd);
  stdin.on("pause", () => {
    const internal = stdin as unknown as {
      _handle?: { reading: boolean; readStop(): void };
      _readableState: { reading: boolean };
    };
    const handle = internal._handle;
    if (!handle) return;
    internal._readableState.reading = false;
    handle.reading = false;
    handle.readStop();
  });
  io.replaceStdin(stdin);
  consoleStdinFd = fd;
  return fd;
}

let consoleStdinFd: number | undefined;

export const interactiveStdin = (): number | "inherit" => consoleStdinFd ?? "inherit";
