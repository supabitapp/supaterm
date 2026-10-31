// @effect-diagnostics nodeBuiltinImport:off - adapts tunnel bytes to Node's native HTTP socket API.
import * as NodeNet from "node:net";
import * as NodeStream from "node:stream";
import { after } from "./timer.ts";
import { HttpHostGuard } from "./httpHostGuard.ts";
import type { LoopbackRelay } from "./loopbackPool.ts";
import type { TunnelStream } from "./tunnel.ts";
import { createTunnelConnector, type TunnelConnectorOptions } from "./tunnel.ts";

export type TunnelPeer =
  | { readonly transport: "relay" }
  | { readonly transport: "direct"; readonly remoteAddress: string };

export class TunnelSocket extends NodeStream.Duplex {
  readonly transport: TunnelPeer["transport"];
  readonly remoteAddress: string;
  readonly remoteFamily: string;
  readonly remotePort = 0;
  private owed = 0;
  private idleMs = 0;
  private cancelIdle: (() => void) | undefined;
  private readonly stream: TunnelStream;

  constructor(stream: TunnelStream, peer: TunnelPeer = { transport: "relay" }) {
    super({ allowHalfOpen: true });
    this.transport = peer.transport;
    this.remoteAddress = peer.transport === "relay" ? "relay" : peer.remoteAddress;
    this.remoteFamily =
      peer.transport === "relay" ? "relay" : NodeNet.isIPv6(peer.remoteAddress) ? "IPv6" : "IPv4";
    this.stream = stream;
    stream.onData = (data) => {
      this.touch();
      if (this.push(data)) stream.consumed(data.length);
      else this.owed += data.length;
    };
    stream.onEnd = () => this.push(null);
    stream.onClose = (error) => {
      if (this.destroyed) return;
      if (error) this.destroy(error);
      else if (!this.readableEnded) this.push(null);
    };
  }

  override _read() {
    if (this.owed === 0) return;
    const owed = this.owed;
    this.owed = 0;
    this.stream.consumed(owed);
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error) => void) {
    this.touch();
    try {
      this.stream.write(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), callback);
    } catch (error) {
      callback(error instanceof Error ? error : new Error("Tunnel write failed"));
    }
  }

  override _writev(
    chunks: Array<{ chunk: Buffer; encoding: BufferEncoding }>,
    callback: (error?: Error | null) => void,
  ) {
    this.touch();
    const last = chunks.findLastIndex(({ chunk }) => chunk.byteLength > 0);
    if (last === -1) return callback();
    try {
      chunks.forEach(({ chunk }, index) =>
        this.stream.write(
          new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
          index === last ? callback : undefined,
        ),
      );
    } catch (error) {
      callback(error instanceof Error ? error : new Error("Tunnel write failed"));
    }
  }

  override _final(callback: (error?: Error) => void) {
    this.stream.end();
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.cancelIdle?.();
    this.stream.reset();
    callback(error);
  }

  private touch() {
    if (this.idleMs === 0) return;
    this.cancelIdle?.();
    this.cancelIdle = after(this.idleMs, () => this.emit("timeout"));
  }

  setTimeout(milliseconds: number, callback?: () => void) {
    this.idleMs = milliseconds;
    if (callback) this.once("timeout", callback);
    if (milliseconds === 0) this.cancelIdle?.();
    else this.touch();
    return this;
  }
  setNoDelay() {
    return this;
  }
  setKeepAlive() {
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
  address() {
    return { address: "relay", family: "relay", port: 0 };
  }
}

async function listenLoopbackTunnel(open: () => Promise<TunnelStream>) {
  const sockets = new Set<NodeNet.Socket>();
  let port = 0;
  const pipe = (socket: NodeNet.Socket, guard: HttpHostGuard, head: Buffer) => {
    open().then(
      (stream) => {
        if (socket.destroyed) {
          stream.reset();
          return;
        }
        const remote = new TunnelSocket(stream);
        socket.on("error", () => remote.destroy());
        remote.on("error", () => socket.destroy());
        remote.on("data", (bytes: Buffer) => guard.observeResponse(bytes));
        remote.once("end", () => {
          if (guard.awaitingUpgrade) socket.destroy();
        });
        socket.once("close", () => remote.destroy());
        remote.once("close", () => socket.destroy());
        guard.startUpgradeTimeout();
        if (head.length > 0) remote.write(head);
        guard.pipe(remote);
        remote.pipe(socket);
        socket.resume();
      },
      () => socket.destroy(),
    );
  };
  const accept = (socket: NodeNet.Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const expected = `127.0.0.1:${port}`;
    const guard = new HttpHostGuard(expected);
    let started = false;
    socket.once("end", () => {
      if (!started) socket.destroy();
    });
    socket.once("close", () => guard.destroy());
    guard.on("error", () => socket.destroy());
    guard.once("data", (head: Buffer) => {
      started = true;
      guard.pause();
      socket.pause();
      pipe(socket, guard, head);
    });
    socket.pipe(guard);
  };
  const server = NodeNet.createServer({ allowHalfOpen: true, noDelay: true }, accept);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as NodeNet.AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

export async function openLoopbackRelay(
  address: string,
  options: TunnelConnectorOptions,
): Promise<LoopbackRelay> {
  const connector = createTunnelConnector(address, options);
  try {
    const listener = await listenLoopbackTunnel(() => connector.open());
    return {
      origin: listener.origin,
      close: async () => {
        connector.close();
        await listener.close();
      },
    };
  } catch (error) {
    connector.close();
    throw error;
  }
}
