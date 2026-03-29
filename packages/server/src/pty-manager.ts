import { existsSync } from "fs";
import net from "node:net";
import { join, resolve } from "path";
import { CLI_ENV } from "@supaterm/shared";
import type { PtyClient } from "./transport.js";

const DEFAULT_SCROLLBACK_SIZE = 1024 * 1024;
const COALESCE_MS = 4;
const LOCAL_ZMX = resolve(
  import.meta.dirname,
  "../../../ThirdParty/zmx/zig-out/bin/zmx",
);
const HEADER_SIZE = 8;
const HEADER_LENGTH_OFFSET = 1;
const HISTORY_FORMAT_VT = 1;
const INPUT_PROMPT_KICK = "\r";

enum ZmxMessageTag {
  Input = 0,
  Output = 1,
  Resize = 2,
  Detach = 3,
  Kill = 5,
  Init = 7,
  History = 8,
}

export interface ManagedPty {
  id: string;
  socket: net.Socket | null;
  cols: number;
  rows: number;
  title: string;
  pwd: string | undefined;
  isRunning: boolean;
  outputOffset: number;
  scrollbackBuffer: Uint8Array;
  scrollbackWritePos: number;
  sessionName: string;
  launchOptions: SessionLaunchOptions;
  env: Record<string, string>;
  connectedClients: Set<PtyClient>;
  isDetaching: boolean;
  readBuffer: Buffer;
  needsPromptKick: boolean;
  pendingWrites: Buffer[];
}

export interface PtyWsData {
  type: "pty";
  paneId: string;
}

export interface PtyCreateOptions {
  id: string;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
  command?: string;
  socketPath?: string;
  sessionName: string;
  tabId?: string;
}

type SessionLaunchOptions = Pick<
  PtyCreateOptions,
  "id" | "cols" | "rows" | "sessionName" | "shell" | "cwd" | "command" | "tabId"
>;

export function resolveManagedZmxBinary(): string {
  const explicitZmxPath = process.env[CLI_ENV.ZMX_PATH];
  if (explicitZmxPath && existsSync(explicitZmxPath)) {
    return explicitZmxPath;
  }

  if (existsSync(LOCAL_ZMX)) return LOCAL_ZMX;
  throw new Error(
    `Missing managed zmx binary at ${LOCAL_ZMX}. Run 'make build-zmx' before starting the server.`,
  );
}

export function resolveZmxSocketDirectory(
  environment: Record<string, string> = process.env as Record<string, string>,
): string {
  const explicitDirectory = environment.ZMX_DIR;
  if (explicitDirectory && explicitDirectory.length > 0) {
    return explicitDirectory;
  }

  const runtimeDirectory = environment.XDG_RUNTIME_DIR;
  if (runtimeDirectory && runtimeDirectory.length > 0) {
    return join(runtimeDirectory, "zmx");
  }

  const tmpDirectory = environment.TMPDIR;
  if (tmpDirectory && tmpDirectory.length > 0) {
    const trimmedTmpDirectory = tmpDirectory.replace(/\/+$/, "");
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    return `${trimmedTmpDirectory}/zmx-${uid}`;
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return `/tmp/zmx-${uid}`;
}

export function resolveSessionSocketPath(
  sessionName: string,
  environment: Record<string, string> = process.env as Record<string, string>,
): string {
  return join(resolveZmxSocketDirectory(environment), sessionName);
}

export function buildManagedPaneEnvironment(
  options: Pick<
    PtyCreateOptions,
    "id" | "sessionName" | "socketPath" | "tabId" | "env"
  >,
  baseEnvironment: Record<string, string> = process.env as Record<string, string>,
  zmxBinary: string = resolveManagedZmxBinary(),
): Record<string, string> {
  return {
    ...baseEnvironment,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    [CLI_ENV.SURFACE_ID]: options.id,
    ...(options.tabId ? { [CLI_ENV.TAB_ID]: options.tabId } : {}),
    [CLI_ENV.PANE_SESSION]: options.sessionName,
    [CLI_ENV.ZMX_PATH]: zmxBinary,
    ...(options.socketPath
      ? { [CLI_ENV.SOCKET_PATH]: options.socketPath }
      : {}),
    ...options.env,
  };
}

export function buildSessionBootstrapArgs(
  sessionName: string,
  shell: string,
  command?: string,
): string[] {
  if (command && command.trim().length > 0) {
    return ["run", sessionName, shell, "-lc", command];
  }

  return ["run", sessionName];
}

export class PtyManager {
  private ptys = new Map<string, ManagedPty>();
  private coalesceBuffers = new Map<string, Uint8Array[]>();
  private coalesceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private textDecoder = new TextDecoder();

  onPaneTitleChanged?: (paneId: string, title: string) => void;
  onPaneExited?: (paneId: string) => void;

  create(options: PtyCreateOptions): ManagedPty {
    const launchOptions: SessionLaunchOptions = {
      id: options.id,
      cols: options.cols,
      rows: options.rows,
      sessionName: options.sessionName,
      shell: options.shell,
      cwd: options.cwd,
      command: options.command,
      tabId: options.tabId,
    };
    const env = buildManagedPaneEnvironment(options);

    const managed: ManagedPty = {
      id: options.id,
      socket: null,
      cols: options.cols,
      rows: options.rows,
      title: "shell",
      pwd: options.cwd,
      isRunning: true,
      outputOffset: 0,
      scrollbackBuffer: new Uint8Array(DEFAULT_SCROLLBACK_SIZE),
      scrollbackWritePos: 0,
      sessionName: options.sessionName,
      launchOptions,
      env,
      connectedClients: new Set(),
      isDetaching: false,
      readBuffer: Buffer.alloc(0),
      needsPromptKick: !options.command,
      pendingWrites: [],
    };

    this.ptys.set(options.id, managed);
    this.ensureSession(managed);
    this.connectSocket(managed);
    return managed;
  }

  destroy(paneId: string): void {
    const managed = this.ptys.get(paneId);
    if (!managed) return;
    this.sendMessage(managed, ZmxMessageTag.Kill);
    this.killSession(managed.sessionName, managed.env);
    this.closeSocket(managed, false);
    this.cleanupPane(paneId);
  }

  detach(paneId: string): void {
    const managed = this.ptys.get(paneId);
    if (!managed) return;
    this.sendMessage(managed, ZmxMessageTag.Detach);
    this.closeSocket(managed, true);
    this.cleanupPane(paneId);
  }

  write(
    paneId: string,
    data: Uint8Array | Buffer | string,
    _ws?: PtyClient,
  ): void {
    const managed = this.ptys.get(paneId);
    if (!managed?.isRunning) return;
    this.ensureConnected(managed);
    const payload = typeof data === "string"
      ? Buffer.from(data)
      : Buffer.from(data);
    this.sendMessage(managed, ZmxMessageTag.Input, payload);
  }

  resize(
    paneId: string,
    cols: number,
    rows: number,
    _ws?: PtyClient,
  ): void {
    const managed = this.ptys.get(paneId);
    if (!managed) return;
    managed.cols = cols;
    managed.rows = rows;
    this.ensureConnected(managed);
    const payload = Buffer.alloc(4);
    payload.writeUInt16LE(rows, 0);
    payload.writeUInt16LE(cols, 2);
    this.sendMessage(managed, ZmxMessageTag.Resize, payload);
  }

  get(paneId: string): ManagedPty | undefined {
    return this.ptys.get(paneId);
  }

  addClient(paneId: string, ws: PtyClient): void {
    const managed = this.ptys.get(paneId);
    if (!managed) return;
    managed.connectedClients.add(ws);
    this.ensureConnected(managed);
    this.replayScrollback(managed, ws);
  }

  removeClient(paneId: string, ws: PtyClient): void {
    const managed = this.ptys.get(paneId);
    if (!managed) return;
    managed.connectedClients.delete(ws);
  }

  destroyAll(killSessions = true): void {
    for (const [paneId, managed] of this.ptys) {
      if (killSessions) {
        this.sendMessage(managed, ZmxMessageTag.Kill);
        this.killSession(managed.sessionName, managed.env);
      } else {
        this.sendMessage(managed, ZmxMessageTag.Detach);
      }
      this.closeSocket(managed, !killSessions);
      this.cleanupPane(paneId);
    }
  }

  private ensureSession(managed: ManagedPty): void {
    const shell =
      managed.launchOptions.shell ??
      process.env.SHELL ??
      (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
    const args = buildSessionBootstrapArgs(
      managed.sessionName,
      shell,
      managed.launchOptions.command,
    );
    const result = Bun.spawnSync(
      [resolveManagedZmxBinary(), ...args],
      {
        cwd: managed.launchOptions.cwd ?? process.env.HOME ?? "/",
        env: managed.env,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    );

    const socketPath = resolveSessionSocketPath(managed.sessionName, managed.env);
    if (result.exitCode === 0 || existsSync(socketPath)) {
      this.waitForSocket(socketPath);
      return;
    }

    throw new Error(
      `Failed to bootstrap zmx session ${managed.sessionName} (exit ${result.exitCode})`,
    );
  }

  private waitForSocket(socketPath: string): void {
    const start = Date.now();
    while (!existsSync(socketPath)) {
      if (Date.now() - start > 1000) {
        throw new Error(`Timed out waiting for zmx socket at ${socketPath}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }

  private connectSocket(managed: ManagedPty): void {
    if (managed.socket && !managed.socket.destroyed) return;

    const socket = net.createConnection(
      resolveSessionSocketPath(managed.sessionName, managed.env),
    );
    managed.socket = socket;
    managed.readBuffer = Buffer.alloc(0);
    managed.isRunning = true;
    managed.isDetaching = false;

    socket.on("connect", () => {
      if (managed.socket !== socket) return;
      this.flushPendingWrites(managed);
      this.initializeClient(managed);
    });

    socket.on("data", (chunk: Buffer) => {
      if (managed.socket !== socket) return;
      this.handleSocketData(managed, Buffer.from(chunk));
    });

    socket.on("close", () => {
      if (managed.socket !== socket) return;
      managed.socket = null;
      if (managed.isDetaching) {
        managed.isDetaching = false;
        return;
      }
      if (managed.isRunning) {
        managed.isRunning = false;
        this.flushCoalesce(managed.id);
        this.onPaneExited?.(managed.id);
      }
    });

    socket.on("error", () => {
      if (managed.socket !== socket) return;
      socket.destroy();
    });
  }

  private initializeClient(managed: ManagedPty): void {
    const resizePayload = Buffer.alloc(4);
    resizePayload.writeUInt16LE(managed.rows, 0);
    resizePayload.writeUInt16LE(managed.cols, 2);
    this.sendMessage(managed, ZmxMessageTag.Init, resizePayload);
    this.sendMessage(
      managed,
      ZmxMessageTag.History,
      Buffer.from([HISTORY_FORMAT_VT]),
    );

    if (managed.needsPromptKick) {
      managed.needsPromptKick = false;
      setTimeout(() => {
        if (!this.ptys.has(managed.id) || !managed.isRunning) return;
        this.sendMessage(
          managed,
          ZmxMessageTag.Input,
          Buffer.from(INPUT_PROMPT_KICK),
        );
      }, 150);
    }
  }

  private ensureConnected(managed: ManagedPty): void {
    if (managed.socket && !managed.socket.destroyed) return;
    this.connectSocket(managed);
  }

  private sendMessage(
    managed: ManagedPty,
    tag: ZmxMessageTag,
    payload: Uint8Array | Buffer = Buffer.alloc(0),
  ): void {
    const socket = managed.socket;
    const data = Buffer.from(payload);
    const message = Buffer.alloc(HEADER_SIZE + data.length);
    message.writeUInt8(tag, 0);
    message.writeUInt32LE(data.length, HEADER_LENGTH_OFFSET);
    data.copy(message, HEADER_SIZE);
    if (!socket || socket.destroyed || socket.readyState !== "open") {
      managed.pendingWrites.push(message);
      return;
    }
    socket.write(message);
  }

  private flushPendingWrites(managed: ManagedPty): void {
    const socket = managed.socket;
    if (!socket || socket.destroyed || socket.readyState !== "open") return;
    for (const message of managed.pendingWrites) {
      socket.write(message);
    }
    managed.pendingWrites = [];
  }

  private handleSocketData(managed: ManagedPty, chunk: Buffer): void {
    managed.readBuffer = Buffer.concat([managed.readBuffer, chunk]);

    while (managed.readBuffer.length >= HEADER_SIZE) {
      const payloadLength = managed.readBuffer.readUInt32LE(HEADER_LENGTH_OFFSET);
      const totalLength = HEADER_SIZE + payloadLength;
      if (managed.readBuffer.length < totalLength) {
        return;
      }

      const tag = managed.readBuffer.readUInt8(0);
      const payload = managed.readBuffer.subarray(HEADER_SIZE, totalLength);
      managed.readBuffer = managed.readBuffer.subarray(totalLength);

      if (tag === ZmxMessageTag.Output || tag === ZmxMessageTag.History) {
        this.handleRenderablePayload(managed, payload);
      }
    }
  }

  private handleRenderablePayload(managed: ManagedPty, payload: Uint8Array): void {
    if (payload.length === 0) return;

    this.appendToScrollback(managed, payload);
    managed.outputOffset += payload.length;
    this.coalesceSend(managed.id, new Uint8Array(payload));

    const text = this.textDecoder.decode(payload, { stream: true });
    const title = this.extractPaneTitle(text);
    if (title !== null) {
      managed.title = title;
      this.onPaneTitleChanged?.(managed.id, managed.title);
    }
  }

  private extractPaneTitle(text: string): string | null {
    const oscTitlePrefix = "\u001b]2;";
    const prefixIndex = text.indexOf(oscTitlePrefix);
    if (prefixIndex === -1) return null;

    const titleStart = prefixIndex + oscTitlePrefix.length;
    const bellIndex = text.indexOf("\u0007", titleStart);
    const stIndex = text.indexOf("\u001b\\", titleStart);
    const titleEndCandidates = [bellIndex, stIndex].filter((index) => index !== -1);
    if (titleEndCandidates.length === 0) return null;

    return text.slice(titleStart, Math.min(...titleEndCandidates));
  }

  private closeSocket(managed: ManagedPty, keepSessionAlive: boolean): void {
    managed.isDetaching = keepSessionAlive;
    const socket = managed.socket;
    managed.socket = null;
    managed.pendingWrites = [];
    if (!socket) return;
    try {
      socket.end();
      socket.destroy();
    } catch {}
  }

  private killSession(
    sessionName: string,
    environment: Record<string, string>,
  ): void {
    try {
      Bun.spawnSync(
        [resolveManagedZmxBinary(), "kill", sessionName],
        {
          stdout: "ignore",
          stderr: "ignore",
          env: environment,
        },
      );
    } catch {}
  }

  private cleanupPane(paneId: string): void {
    this.ptys.delete(paneId);
    this.coalesceBuffers.delete(paneId);
    const timer = this.coalesceTimers.get(paneId);
    if (timer) clearTimeout(timer);
    this.coalesceTimers.delete(paneId);
  }

  private appendToScrollback(managed: ManagedPty, data: Uint8Array): void {
    const buf = managed.scrollbackBuffer;
    const pos = managed.scrollbackWritePos % buf.length;
    const space = buf.length - pos;
    if (data.length <= space) {
      buf.set(data, pos);
    } else {
      buf.set(data.subarray(0, space), pos);
      buf.set(data.subarray(space), 0);
    }
    managed.scrollbackWritePos += data.length;
  }

  private replayScrollback(
    managed: ManagedPty,
    ws: PtyClient,
  ): void {
    const buf = managed.scrollbackBuffer;
    const written = managed.scrollbackWritePos;
    if (written === 0) return;

    if (written <= buf.length) {
      ws.sendBinary(buf.slice(0, written));
      return;
    }

    const pos = written % buf.length;
    const first = buf.slice(pos);
    const second = buf.slice(0, pos);
    const combined = new Uint8Array(buf.length);
    combined.set(first, 0);
    combined.set(second, first.length);
    ws.sendBinary(combined);
  }

  private coalesceSend(paneId: string, data: Uint8Array): void {
    let buffers = this.coalesceBuffers.get(paneId);
    if (!buffers) {
      buffers = [];
      this.coalesceBuffers.set(paneId, buffers);
    }
    buffers.push(data);

    if (!this.coalesceTimers.has(paneId)) {
      this.coalesceTimers.set(
        paneId,
        setTimeout(() => this.flushCoalesce(paneId), COALESCE_MS),
      );
    }
  }

  private flushCoalesce(paneId: string): void {
    const timer = this.coalesceTimers.get(paneId);
    if (timer) clearTimeout(timer);
    this.coalesceTimers.delete(paneId);

    const buffers = this.coalesceBuffers.get(paneId);
    if (!buffers || buffers.length === 0) return;
    this.coalesceBuffers.set(paneId, []);

    const managed = this.ptys.get(paneId);
    if (!managed) return;

    let combined: Uint8Array;
    if (buffers.length === 1) {
      combined = buffers[0]!;
    } else {
      const totalLen = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
      combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const buffer of buffers) {
        combined.set(buffer, offset);
        offset += buffer.length;
      }
    }

    for (const ws of managed.connectedClients) {
      try {
        ws.sendBinary(combined);
      } catch {}
    }
  }
}
