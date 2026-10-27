import type { WebSocketLike } from "effect/socket/Socket";
import { after, every } from "./timer.ts";
import {
  DEFAULT_PUBLIC_RELAY_URL,
  MAX_DIRECT_TUNNEL_URLS,
  normalizeRelayServerUrl,
} from "@supaterm/contracts";
import {
  createClientHandshake,
  parseRelayAddress,
  relayEndpointId,
  type RelayCipher,
} from "./protocol.ts";

const OPEN = 1;
const DATA = 2;
const WINDOW = 3;
const FIN = 4;
const RST = 5;
const PING = 6;
const PONG = 7;
const HEADER_BYTES = 9;
export const TUNNEL_MAX_PLAIN_BYTES = 64 * 1024;
const SESSION_WINDOW = 8 * 1024 * 1024;
const MIN_MESSAGE_COST = 48 * 1024;
export const TUNNEL_STREAM_WINDOW = 2 * 1024 * 1024;
const STREAM_SEND_QUEUE_BYTES = 8 * 1024 * 1024;
const MAX_STREAMS = 256;
export const TUNNEL_KEEPALIVE_MS = 15_000;
const KEEPALIVE_MISSES = 3;

export interface TunnelStream {
  readonly id: number;
  write(data: Uint8Array, sent?: (error?: Error) => void): void;
  end(): void;
  reset(): void;
  consumed(bytes: number): void;
  onData: (data: Uint8Array) => void;
  onEnd: () => void;
  onClose: (error?: Error) => void;
}

export interface TunnelSession {
  open(): TunnelStream;
  receive(message: Uint8Array): void;
  close(error?: Error): void;
  readonly closed: boolean;
  readonly streamCount: number;
}

interface StreamState {
  readonly stream: TunnelStream;
  readonly pending: { data: Uint8Array; sent?: (error?: Error) => void }[];
  pendingBytes: number;
  unconsumed: number;
  sendCredit: number;
  receiveCredit: number;
  receiveGrant: number;
  localEnded: boolean;
  finQueued: boolean;
  remoteEnded: boolean;
  closed: boolean;
}

export function createTunnelSession(input: {
  readonly cipher: RelayCipher;
  readonly send: (message: Uint8Array<ArrayBuffer>) => void;
  readonly initiator: boolean;
  readonly onStream?: (stream: TunnelStream) => void;
  readonly onClose?: (error?: Error) => void;
}): TunnelSession {
  const streams = new Map<number, StreamState>();
  const control: Uint8Array[] = [];
  const ready: StreamState[] = [];
  let sessionCredit = SESSION_WINDOW;
  let sessionReceiveCredit = SESSION_WINDOW;
  let sessionGrant = 0;
  let nextId = input.initiator ? 1 : 2;
  let lastRemoteId = 0;
  let scheduled = false;
  let closed = false;
  let receivedSinceTick = false;
  let idleTicks = 0;

  const frame = (type: number, id: number, payload?: Uint8Array) => {
    const bytes = new Uint8Array(HEADER_BYTES + (payload?.length ?? 0));
    const view = new DataView(bytes.buffer);
    view.setUint8(0, type);
    view.setUint32(1, id);
    view.setUint32(5, payload?.length ?? 0);
    if (payload) bytes.set(payload, HEADER_BYTES);
    return bytes;
  };
  const windowFrame = (id: number, bytes: number) => {
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, bytes);
    return frame(WINDOW, id, payload);
  };
  const schedule = () => {
    if (scheduled || closed) return;
    scheduled = true;
    queueMicrotask(pump);
  };
  const markReady = (state: StreamState) => {
    if (!ready.includes(state)) ready.push(state);
    schedule();
  };
  const grantSession = (bytes: number) => {
    if (closed) return;
    sessionGrant += bytes;
    if (
      sessionGrant > 0 &&
      (sessionGrant >= SESSION_WINDOW / 4 || sessionReceiveCredit < SESSION_WINDOW / 4)
    ) {
      control.push(windowFrame(0, sessionGrant));
      sessionReceiveCredit += sessionGrant;
      sessionGrant = 0;
      schedule();
    }
  };
  const finish = (state: StreamState, error?: Error) => {
    if (state.closed) return;
    state.closed = true;
    streams.delete(state.stream.id);
    const index = ready.indexOf(state);
    if (index >= 0) ready.splice(index, 1);
    for (const item of state.pending.splice(0))
      item.sent?.(error ?? new Error("Tunnel stream closed"));
    state.pendingBytes = 0;
    grantSession(state.unconsumed);
    state.unconsumed = 0;
    state.stream.onClose(error);
  };
  const maybeFinish = (state: StreamState) => {
    if (
      state.finQueued &&
      state.remoteEnded &&
      state.pending.length === 0 &&
      state.unconsumed === 0
    )
      finish(state);
  };

  function pump() {
    scheduled = false;
    // eslint-disable-next-line no-unmodified-loop-condition -- Socket sends and consumer callbacks can close the session.
    while (!closed) {
      const parts: Uint8Array[] = [];
      const callbacks: ((error?: Error) => void)[] = [];
      let size = 0;
      let data = 0;
      while (control.length > 0 && size + control[0]!.length <= TUNNEL_MAX_PLAIN_BYTES) {
        const next = control.shift()!;
        parts.push(next);
        size += next.length;
      }
      for (let pass = ready.length; pass > 0 && size < TUNNEL_MAX_PLAIN_BYTES; pass--) {
        const state = ready.shift()!;
        while (state.pending.length > 0) {
          const head = state.pending[0]!;
          const room = Math.min(
            TUNNEL_MAX_PLAIN_BYTES - size - HEADER_BYTES,
            state.sendCredit,
            sessionCredit >= MIN_MESSAGE_COST ? sessionCredit - data : 0,
          );
          if (room <= 0) break;
          const chunk = head.data.subarray(0, room);
          parts.push(frame(DATA, state.stream.id, chunk));
          size += HEADER_BYTES + chunk.length;
          data += chunk.length;
          state.pendingBytes -= chunk.length;
          state.sendCredit -= chunk.length;
          if (chunk.length === head.data.length) {
            state.pending.shift();
            if (head.sent) callbacks.push(head.sent);
          } else head.data = head.data.subarray(chunk.length);
        }
        if (
          state.pending.length === 0 &&
          state.localEnded &&
          !state.finQueued &&
          size + HEADER_BYTES <= TUNNEL_MAX_PLAIN_BYTES
        ) {
          state.finQueued = true;
          const fin = frame(FIN, state.stream.id);
          parts.push(fin);
          size += fin.length;
          maybeFinish(state);
        }
        if (
          (state.pending.length > 0 && state.sendCredit > 0) ||
          (state.localEnded && !state.finQueued)
        )
          ready.push(state);
      }
      if (parts.length === 0) return;
      if (data > 0) sessionCredit -= Math.max(data, MIN_MESSAGE_COST);
      const plain = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        plain.set(part, offset);
        offset += part.length;
      }
      try {
        input.send(input.cipher.seal(plain));
      } catch (error) {
        const failure = error instanceof Error ? error : new Error("Relay send failed");
        for (const callback of callbacks) callback(failure);
        session.close(failure);
        return;
      }
      for (const callback of callbacks) callback();
      if (sessionCredit < MIN_MESSAGE_COST && control.length === 0) return;
    }
  }

  const createStream = (id: number): StreamState => {
    const state: StreamState = {
      stream: {
        id,
        write(bytes, sent) {
          if (state.closed || state.localEnded) throw new Error("Tunnel stream closed");
          if (bytes.length === 0) {
            sent?.();
            return;
          }
          if (state.pendingBytes + bytes.length > STREAM_SEND_QUEUE_BYTES)
            throw new Error("Tunnel stream send queue full");
          state.pendingBytes += bytes.length;
          state.pending.push({ data: bytes, ...(sent ? { sent } : {}) });
          if (state.sendCredit > 0) markReady(state);
        },
        end() {
          if (state.closed || state.localEnded) return;
          state.localEnded = true;
          markReady(state);
        },
        reset() {
          if (state.closed) return;
          control.push(frame(RST, id));
          schedule();
          finish(state);
        },
        consumed(bytes) {
          if (state.closed) return;
          if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > state.unconsumed)
            throw new Error("Invalid tunnel consumption");
          state.unconsumed -= bytes;
          grantSession(bytes);
          state.receiveGrant += bytes;
          if (state.receiveGrant >= TUNNEL_STREAM_WINDOW / 4) {
            control.push(windowFrame(id, state.receiveGrant));
            state.receiveCredit += state.receiveGrant;
            state.receiveGrant = 0;
            schedule();
          }
          maybeFinish(state);
        },
        onData: () => {},
        onEnd: () => {},
        onClose: () => {},
      },
      pending: [],
      pendingBytes: 0,
      unconsumed: 0,
      sendCredit: TUNNEL_STREAM_WINDOW,
      receiveCredit: TUNNEL_STREAM_WINDOW,
      receiveGrant: 0,
      localEnded: false,
      finQueued: false,
      remoteEnded: false,
      closed: false,
    };
    streams.set(id, state);
    return state;
  };

  const stopKeepalive = every(TUNNEL_KEEPALIVE_MS, () => {
    if (receivedSinceTick) {
      receivedSinceTick = false;
      idleTicks = 0;
    } else if (++idleTicks >= KEEPALIVE_MISSES) {
      session.close(new Error("Relay session timed out"));
    } else {
      control.push(frame(PING, 0));
      schedule();
    }
  });

  const session: TunnelSession = {
    get closed() {
      return closed;
    },
    get streamCount() {
      return streams.size;
    },
    open() {
      if (closed) throw new Error("Tunnel session closed");
      if (!input.initiator) throw new Error("Only the tunnel client can open streams");
      if (streams.size >= MAX_STREAMS) throw new Error("Too many tunnel streams");
      if (nextId > 0xffff_ffff) throw new Error("Tunnel stream identifiers exhausted");
      const id = nextId;
      nextId += 2;
      const state = createStream(id);
      control.push(frame(OPEN, id));
      schedule();
      return state.stream;
    },
    receive(message) {
      if (closed) return;
      let plain: Uint8Array;
      try {
        plain = input.cipher.open(message, TUNNEL_MAX_PLAIN_BYTES);
      } catch (error) {
        session.close(error instanceof Error ? error : new Error("Invalid tunnel message"));
        return;
      }
      const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
      let offset = 0;
      let data = 0;
      try {
        for (let start = 0; start < plain.length;) {
          if (start + HEADER_BYTES > plain.length) throw new Error("Truncated tunnel frame");
          const length = view.getUint32(start + 5);
          if (start + HEADER_BYTES + length > plain.length)
            throw new Error("Truncated tunnel frame");
          if (view.getUint8(start) === DATA) data += length;
          start += HEADER_BYTES + length;
        }
        receivedSinceTick = true;
        if (data > 0) {
          const cost = Math.max(data, MIN_MESSAGE_COST);
          if (cost > sessionReceiveCredit) throw new Error("Tunnel session window exceeded");
          sessionReceiveCredit -= cost;
          grantSession(cost - data);
        }
        while (offset < plain.length) {
          if (closed) break;
          if (offset + HEADER_BYTES > plain.length) throw new Error("Truncated tunnel frame");
          const type = view.getUint8(offset);
          const id = view.getUint32(offset + 1);
          const length = view.getUint32(offset + 5);
          const start = offset + HEADER_BYTES;
          if (start + length > plain.length) throw new Error("Truncated tunnel frame");
          const payload = plain.subarray(start, start + length);
          offset = start + length;
          if (id !== 0 && id % 2 === 0) throw new Error("Invalid tunnel stream identifier");
          if (type === WINDOW) {
            if (length !== 4) throw new Error("Invalid tunnel window");
            const bytes = view.getUint32(start);
            if (bytes === 0) throw new Error("Invalid tunnel window");
            if (id === 0) {
              sessionCredit += bytes;
              if (sessionCredit > SESSION_WINDOW) throw new Error("Tunnel window overflow");
              for (const state of streams.values())
                if (state.pending.length > 0 || state.localEnded) markReady(state);
            } else {
              const state = streams.get(id);
              if (!state) continue;
              state.sendCredit += bytes;
              if (state.sendCredit > TUNNEL_STREAM_WINDOW)
                throw new Error("Tunnel window overflow");
              if (state.pending.length > 0) markReady(state);
            }
            continue;
          }
          if (type === PING || type === PONG) {
            if (id !== 0 || length !== 0) throw new Error("Invalid tunnel keepalive");
            if (type === PING) {
              control.push(frame(PONG, 0));
              schedule();
            }
            continue;
          }
          if (type === OPEN) {
            if (length !== 0 || input.initiator || id <= lastRemoteId || !input.onStream)
              throw new Error("Invalid tunnel open");
            lastRemoteId = id;
            if (streams.size >= MAX_STREAMS) {
              control.push(frame(RST, id));
              schedule();
              continue;
            }
            input.onStream(createStream(id).stream);
            continue;
          }
          const state = streams.get(id);
          if (id === 0 || id >= (input.initiator ? nextId : lastRemoteId + 2))
            throw new Error("Unknown tunnel stream");
          if (type === DATA) {
            if (length === 0) throw new Error("Empty tunnel data");
            if (!state || state.remoteEnded) {
              grantSession(length);
              continue;
            }
            if (length > state.receiveCredit) throw new Error("Tunnel window exceeded");
            state.receiveCredit -= length;
            state.unconsumed += length;
            state.stream.onData(payload.slice());
          } else if (type === FIN) {
            if (length !== 0) throw new Error("Invalid tunnel FIN");
            if (!state || state.remoteEnded) continue;
            state.remoteEnded = true;
            state.stream.onEnd();
            maybeFinish(state);
          } else if (type === RST) {
            if (length !== 0) throw new Error("Invalid tunnel RST");
            if (state) finish(state, new Error("Tunnel stream reset"));
          } else throw new Error("Unknown tunnel frame");
        }
      } catch (error) {
        session.close(error instanceof Error ? error : new Error("Invalid tunnel frame"));
        return;
      }
      if (control.length > MAX_STREAMS * 4) {
        session.close(new Error("Tunnel control queue full"));
        return;
      }
    },
    close(error) {
      if (closed) return;
      closed = true;
      stopKeepalive();
      control.length = 0;
      ready.length = 0;
      for (const state of streams.values()) finish(state, error ?? new Error("Tunnel closed"));
      input.cipher.destroy();
      input.onClose?.(error);
    },
  };
  return session;
}

export type TunnelVia = "relay" | "direct";

export function directTunnelUrls(urls: Iterable<string>, relayUrl?: string): string[] {
  const selected = new Set<string>();
  for (const raw of urls) {
    if (selected.size >= MAX_DIRECT_TUNNEL_URLS) break;
    const url = normalizeRelayServerUrl(raw);
    if (url !== null && url !== relayUrl) selected.add(url);
  }
  return [...selected];
}

export interface TunnelClientOptions {
  readonly createSocket: (url: string) => WebSocketLike;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly relayUrl?: string;
  readonly directUrls?: () => ReadonlyArray<string>;
  readonly handshakeTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

// An unreachable LAN address must not hold back the relay's answer that the
// host is offline, so direct candidates give up well before the relay does.
const DIRECT_HANDSHAKE_TIMEOUT_MS = 5_000;

interface EstablishedTunnel {
  readonly session: TunnelSession;
  readonly via: TunnelVia;
}

function dialCandidate(
  url: string,
  identity: Uint8Array,
  options: TunnelClientOptions,
  timeoutMs: number,
  signal: AbortSignal,
  claim: () => boolean,
  onClose?: (error?: Error) => void,
): Promise<TunnelSession> {
  return new Promise((resolve, reject) => {
    const handshake = createClientHandshake(identity, options.randomBytes, 2);
    let session: TunnelSession | undefined;
    let socket: WebSocketLike | undefined;
    let failed = false;
    const fail = (error: Error) => {
      failed = true;
      signal.removeEventListener("abort", abort);
      cancelTimeout();
      handshake.destroy();
      if (session) session.close(error);
      else reject(error);
      socket?.close();
    };
    const abort = () => fail(new Error("Relay connection canceled"));
    signal.addEventListener("abort", abort, { once: true });
    const cancelTimeout = after(timeoutMs, () => fail(new Error("Relay handshake timed out")));
    if (signal.aborted) {
      abort();
      return;
    }
    let opened: WebSocketLike;
    try {
      opened = options.createSocket(`${url}/v1/connect?endpointId=${relayEndpointId(identity)}`);
    } catch (error) {
      fail(error instanceof Error ? error : new Error("Relay connection failed"));
      return;
    }
    socket = opened;
    if ("binaryType" in opened) opened.binaryType = "arraybuffer";
    opened.addEventListener("open", () => opened.send(handshake.hello));
    opened.addEventListener("close", (event) =>
      fail(new Error(event.reason || "Relay disconnected")),
    );
    opened.addEventListener("error", () => fail(new Error("Relay connection failed")));
    opened.addEventListener("message", (event) => {
      if (session) {
        const data = event.data;
        if (data instanceof ArrayBuffer) session.receive(new Uint8Array(data));
        else if (data instanceof Uint8Array) session.receive(data);
        else session.close(new Error("Unencrypted relay message"));
        return;
      }
      if (failed) return;
      try {
        if (typeof event.data !== "string" || event.data.length > 4096)
          throw new Error("Invalid relay handshake");
        const cipher = handshake.finish(event.data);
        cancelTimeout();
        signal.removeEventListener("abort", abort);
        // A verified loser no longer hears the race's abort, so it must drop its own keys.
        if (!claim()) {
          cipher.destroy();
          fail(new Error("Relay connection superseded"));
          return;
        }
        session = createTunnelSession({
          cipher,
          initiator: true,
          send: (message) => opened.send(message),
          onClose: (error) => {
            opened.close();
            onClose?.(error);
          },
        });
        resolve(session);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Relay handshake failed"));
      }
    });
  });
}

function connectTunnel(
  address: string,
  options: TunnelClientOptions,
  onClose?: (error?: Error) => void,
): Promise<EstablishedTunnel> {
  const identity = parseRelayAddress(address);
  if (!identity) return Promise.reject(new Error("Not a relay address"));
  const relayUrl = options.relayUrl ?? DEFAULT_PUBLIC_RELAY_URL;
  const relayTimeoutMs = options.handshakeTimeoutMs ?? 15_000;
  const candidates: Array<{
    readonly url: string;
    readonly via: TunnelVia;
    readonly timeoutMs: number;
  }> = [
    { url: relayUrl, via: "relay", timeoutMs: relayTimeoutMs },
    ...directTunnelUrls(options.directUrls?.() ?? [], relayUrl).map((url) => ({
      url,
      via: "direct" as const,
      timeoutMs: Math.min(relayTimeoutMs, DIRECT_HANDSHAKE_TIMEOUT_MS),
    })),
  ];
  const race = new AbortController();
  const cancel = () => race.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) race.abort();
  return new Promise((resolve, reject) => {
    const failures: Error[] = [];
    let pending = candidates.length;
    let won = false;
    const claim = () => {
      if (won) return false;
      won = true;
      options.signal?.removeEventListener("abort", cancel);
      race.abort();
      return true;
    };
    candidates.forEach(({ url, via, timeoutMs }, index) => {
      dialCandidate(url, identity, options, timeoutMs, race.signal, claim, onClose).then(
        (session) => resolve({ session, via }),
        (error: Error) => {
          failures[index] = error;
          if (--pending > 0) return;
          options.signal?.removeEventListener("abort", cancel);
          reject(failures[0] ?? error);
        },
      );
    });
  });
}

export function createTunnelConnector(address: string, options: TunnelClientOptions) {
  const controller = new AbortController();
  let current: Promise<EstablishedTunnel> | undefined;
  let live: EstablishedTunnel | undefined;
  let disposed = false;
  const establish = () => {
    if (disposed) return Promise.reject(new Error("Tunnel connector closed"));
    if (!current) {
      const attempt = connectTunnel(address, { ...options, signal: controller.signal }, () => {
        if (current === attempt) current = undefined;
      });
      current = attempt;
      attempt.then(
        (established) => {
          if (current === attempt) live = established;
        },
        () => {
          if (current === attempt) current = undefined;
        },
      );
    }
    return current;
  };
  return {
    async session(): Promise<TunnelSession> {
      return (await establish()).session;
    },
    async open(): Promise<TunnelStream> {
      return (await establish()).session.open();
    },
    via(): TunnelVia | undefined {
      return live?.session.closed === false ? live.via : undefined;
    },
    close() {
      disposed = true;
      controller.abort();
      const attempt = current;
      current = undefined;
      live = undefined;
      void attempt?.then(({ session }) => session.close()).catch(() => {});
    },
  };
}
