import type { ServerWebSocket } from "bun";
import type { Subprocess } from "bun";
import { CLI_ENV } from "@supaterm/shared";
import { resolve } from "path";

const DEFAULT_SCROLLBACK_SIZE = 1024 * 1024; // 1MB circular buffer
const COALESCE_MS = 4;
const PTY_HELPER = resolve(import.meta.dirname, "../pty-helper");

export interface ManagedPty {
  id: string;
  proc: Subprocess;
  childPid: number;
  cols: number;
  rows: number;
  title: string;
  pwd: string | undefined;
  isRunning: boolean;
  outputOffset: number;
  scrollbackBuffer: Uint8Array;
  scrollbackWritePos: number;
  connectedClients: Set<ServerWebSocket<PtyWsData>>;
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
  socketPath?: string;
  tabId?: string;
}

export class PtyManager {
  private ptys = new Map<string, ManagedPty>();
  private coalesceBuffers = new Map<string, Uint8Array[]>();
  private coalesceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private textDecoder = new TextDecoder();

  onPaneTitleChanged?: (paneId: string, title: string) => void;
  onPaneExited?: (paneId: string) => void;

  create(options: PtyCreateOptions): ManagedPty {
    const shell =
      options.shell ??
      process.env.SHELL ??
      (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      [CLI_ENV.SURFACE_ID]: options.id,
      ...(options.tabId ? { [CLI_ENV.TAB_ID]: options.tabId } : {}),
      ...(options.socketPath
        ? { [CLI_ENV.SOCKET_PATH]: options.socketPath }
        : {}),
      ...options.env,
    };

    const proc = Bun.spawn(
      [PTY_HELPER, shell, String(options.cols), String(options.rows)],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
        cwd: options.cwd ?? process.env.HOME ?? "/",
      },
    );

    const managed: ManagedPty = {
      id: options.id,
      proc,
      childPid: 0,
      cols: options.cols,
      rows: options.rows,
      title: shell.split("/").pop() ?? "shell",
      pwd: options.cwd,
      isRunning: true,
      outputOffset: 0,
      scrollbackBuffer: new Uint8Array(DEFAULT_SCROLLBACK_SIZE),
      scrollbackWritePos: 0,
      connectedClients: new Set(),
    };

    this.ptys.set(options.id, managed);
    this.readStatus(managed);
    this.startReading(managed);

    proc.exited.then(() => {
      if (managed.isRunning) {
        managed.isRunning = false;
        this.flushCoalesce(managed.id);
        this.onPaneExited?.(managed.id);
      }
    });

    return managed;
  }

  destroy(paneId: string): void {
    const managed = this.ptys.get(paneId);
    if (!managed) return;
    managed.isRunning = false;
    this.flushCoalesce(paneId);
    try {
      managed.proc.kill();
    } catch {}
    this.ptys.delete(paneId);
    this.coalesceBuffers.delete(paneId);
    const timer = this.coalesceTimers.get(paneId);
    if (timer) clearTimeout(timer);
    this.coalesceTimers.delete(paneId);
  }

  write(paneId: string, data: Uint8Array | Buffer | string): void {
    const managed = this.ptys.get(paneId);
    if (!managed?.isRunning) return;
    const stdin = managed.proc.stdin as import("bun").FileSink;
    if (typeof data === "string") {
      stdin.write(data);
    } else {
      stdin.write(data instanceof Buffer ? data : Buffer.from(data));
    }
  }

  resize(paneId: string, cols: number, rows: number): void {
    const managed = this.ptys.get(paneId);
    if (!managed?.isRunning) return;
    managed.cols = cols;
    managed.rows = rows;
    const resizeCmd = `\x1bPTYRESIZE;${rows};${cols}\x1b\\`;
    const stdin = managed.proc.stdin as import("bun").FileSink;
    stdin.write(resizeCmd);
  }

  get(paneId: string): ManagedPty | undefined {
    return this.ptys.get(paneId);
  }

  addClient(paneId: string, ws: ServerWebSocket<PtyWsData>): void {
    const managed = this.ptys.get(paneId);
    if (!managed) return;
    managed.connectedClients.add(ws);
    this.replayScrollback(managed, ws);
  }

  removeClient(paneId: string, ws: ServerWebSocket<PtyWsData>): void {
    const managed = this.ptys.get(paneId);
    if (!managed) return;
    managed.connectedClients.delete(ws);
  }

  destroyAll(): void {
    for (const [id] of this.ptys) {
      this.destroy(id);
    }
  }

  // --- Reading ---

  private async readStatus(managed: ManagedPty): Promise<void> {
    try {
      const stderr = managed.proc.stderr as ReadableStream<Uint8Array>;
      const reader = stderr.getReader();
      const { value } = await reader.read();
      if (value) {
        const text = this.textDecoder.decode(value, { stream: true });
        try {
          const status = JSON.parse(text.trim().split("\n")[0]!);
          if (status.pid) managed.childPid = status.pid;
        } catch {}
      }
      this.readStatusLoop(managed, reader);
    } catch {}
  }

  private async readStatusLoop(
    managed: ManagedPty,
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    try {
      while (managed.isRunning) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const text = this.textDecoder.decode(value, { stream: true });
          if (text.includes('"exit"')) {
            managed.isRunning = false;
            this.flushCoalesce(managed.id);
            this.onPaneExited?.(managed.id);
          }
        }
      }
    } catch {}
  }

  private async startReading(managed: ManagedPty): Promise<void> {
    try {
      const stdout = managed.proc.stdout as ReadableStream<Uint8Array>;
      const reader = stdout.getReader();
      while (managed.isRunning) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        this.appendToScrollback(managed, value);
        managed.outputOffset += value.length;
        this.coalesceSend(managed.id, value);

        const text = this.textDecoder.decode(value, { stream: true });
        const titleMatch = text.match(
          /\x1b\]2;([^\x07\x1b]*?)(?:\x07|\x1b\\)/,
        );
        if (titleMatch?.[1] !== undefined) {
          managed.title = titleMatch[1];
          this.onPaneTitleChanged?.(managed.id, managed.title);
        }
      }
    } catch {
    } finally {
      if (managed.isRunning) {
        managed.isRunning = false;
        this.flushCoalesce(managed.id);
        this.onPaneExited?.(managed.id);
      }
    }
  }

  // --- Scrollback ---

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
    ws: ServerWebSocket<PtyWsData>,
  ): void {
    const buf = managed.scrollbackBuffer;
    const written = managed.scrollbackWritePos;
    if (written === 0) return;

    if (written <= buf.length) {
      ws.sendBinary(buf.slice(0, written));
    } else {
      const pos = written % buf.length;
      const first = buf.slice(pos);
      const second = buf.slice(0, pos);
      const combined = new Uint8Array(buf.length);
      combined.set(first, 0);
      combined.set(second, first.length);
      ws.sendBinary(combined);
    }
  }

  // --- Output coalescing ---

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
      const totalLen = buffers.reduce((sum, b) => sum + b.length, 0);
      combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const buf of buffers) {
        combined.set(buf, offset);
        offset += buf.length;
      }
    }

    for (const ws of managed.connectedClients) {
      try {
        ws.sendBinary(combined);
      } catch {
        managed.connectedClients.delete(ws);
      }
    }
  }
}
