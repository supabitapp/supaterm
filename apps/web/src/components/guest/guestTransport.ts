import type { GuestLinkPayload } from "@supaterm/contracts";
import { createTunnelConnector, type TunnelStream } from "@supaterm/shared/relay/tunnel";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const boundaryAt = (bytes: Uint8Array, pattern: ReadonlyArray<number>) => {
  for (let index = 0; index <= bytes.length - pattern.length; index++) {
    if (pattern.every((byte, offset) => bytes[index + offset] === byte)) return index;
  }
  return -1;
};
const ROUTES = new Set([
  "redeem",
  "session",
  "messages",
  "stream",
  "render",
  "item",
  "command-output",
  "attachment",
  "media",
]);

export interface GuestTransport {
  request(path: string, init?: RequestInit): Promise<Response>;
  setToken(token: string): void;
  close(): void;
}

export function createGuestTransport(
  link: Pick<GuestLinkPayload, "address" | "relayUrl">,
  token: string | null,
  openTunnel = () =>
    createTunnelConnector(link.address, {
      relayUrl: link.relayUrl,
      createSocket: (url) => new WebSocket(url),
      randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
    }),
): GuestTransport {
  const tunnel = openTunnel();
  return {
    setToken(next) {
      token = next;
    },
    close: () => tunnel.close(),
    async request(path, init) {
      const url = new URL(path, "http://guest.invalid");
      const route = url.pathname.slice("/api/guest/".length);
      if (
        url.origin !== "http://guest.invalid" ||
        !url.pathname.startsWith("/api/guest/") ||
        !ROUTES.has(route)
      ) {
        throw new Error("This route is not available to guests.");
      }
      const request = new Request(url, init);
      if (request.method !== "GET" && request.method !== "POST")
        throw new Error("Invalid guest method.");
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.length > 10 * 1024 * 1024 + 64 * 1024)
        throw new Error("Guest request is too large.");
      const headers = new Headers();
      headers.set("host", "guest.invalid");
      headers.set("connection", "close");
      headers.set("content-length", String(body.length));
      const contentType = request.headers.get("content-type");
      if (contentType) headers.set("content-type", contentType);
      if (token) headers.set("authorization", `Bearer ${token}`);
      const head = encoder.encode(
        `${request.method} ${url.pathname}${url.search} HTTP/1.1\r\n${[...headers].map(([key, value]) => `${key}: ${value}\r\n`).join("")}\r\n`,
      );
      const stream = await tunnel.open();
      return readResponse(stream, head, body, request.signal);
    },
  };
}

function readResponse(
  stream: TunnelStream,
  head: Uint8Array,
  body: Uint8Array,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let pending = new Uint8Array();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let received = 0;
    let remaining: number | undefined;
    let chunked = false;
    let chunkBytes: number | undefined;
    let chunkTerminator = false;
    let ended = false;
    let remoteEnded = false;
    const clean = () => signal.removeEventListener("abort", abort);
    const fail = (error: Error) => {
      if (ended) return;
      ended = true;
      clean();
      reject(error);
      controller?.error(error);
      stream.reset();
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      clean();
      controller?.close();
      stream.reset();
    };
    const abort = () => fail(new Error("Guest request canceled."));
    const consume = (size: number) => {
      const bytes = pending.slice(0, size);
      pending = pending.slice(size);
      stream.consumed(size);
      return bytes;
    };
    const emit = (size: number) => {
      received += size;
      if (received > MAX_RESPONSE_BYTES) throw new Error("Guest response is too large.");
      controller!.enqueue(consume(size));
    };
    const pump = () => {
      if (!controller) {
        const boundary = boundaryAt(pending, [13, 10, 13, 10]);
        if (boundary < 0) {
          if (pending.length > MAX_HEADER_BYTES)
            throw new Error("Guest response headers are too large.");
          return;
        }
        if (boundary > MAX_HEADER_BYTES) throw new Error("Guest response headers are too large.");
        const lines = decoder.decode(consume(boundary + 4)).split("\r\n");
        const status = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(lines.shift() ?? "");
        if (!status) throw new Error("Invalid guest HTTP response.");
        const headers = new Headers();
        for (const line of lines) {
          if (!line) continue;
          const colon = line.indexOf(":");
          if (colon <= 0) throw new Error("Invalid guest HTTP header.");
          headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
        }
        const transfer = headers.get("transfer-encoding");
        chunked = transfer?.toLowerCase() === "chunked";
        if (transfer && !chunked) throw new Error("Invalid guest transfer encoding.");
        const length = headers.get("content-length");
        if (length !== null) {
          if (chunked || !/^\d+$/.test(length)) throw new Error("Invalid guest response length.");
          remaining = Number(length);
          if (!Number.isSafeInteger(remaining) || remaining > MAX_RESPONSE_BYTES)
            throw new Error("Guest response is too large.");
        }
        const statusCode = Number(status[1]);
        const noBody = [204, 205, 304].includes(statusCode);
        const readable = new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
          pull() {
            try {
              pump();
            } catch (error) {
              fail(error instanceof Error ? error : new Error("Invalid guest response."));
            }
          },
          cancel() {
            ended = true;
            clean();
            stream.reset();
          },
        });
        resolve(new Response(noBody ? null : readable, { status: statusCode, headers }));
        if (noBody || remaining === 0) {
          finish();
          return;
        }
      }
      // eslint-disable-next-line no-unmodified-loop-condition -- finish closes the stream when the final body bytes are consumed.
      while (!ended && pending.length > 0 && (controller!.desiredSize ?? 0) > 0) {
        if (!chunked) {
          const size = Math.min(pending.length, remaining ?? pending.length);
          emit(size);
          if (remaining !== undefined) {
            remaining -= size;
            if (remaining === 0) finish();
          }
          continue;
        }
        if (chunkTerminator) {
          if (pending.length < 2) return;
          if (decoder.decode(consume(2)) !== "\r\n")
            throw new Error("Invalid guest chunk terminator.");
          chunkTerminator = false;
        }
        if (chunkBytes === undefined) {
          const lineEnd = boundaryAt(pending, [13, 10]);
          if (lineEnd < 0) {
            if (pending.length > 128) throw new Error("Invalid guest chunk length.");
            return;
          }
          const line = decoder.decode(consume(lineEnd + 2)).trim();
          if (!/^[0-9a-fA-F]{1,8}$/.test(line)) throw new Error("Invalid guest chunk length.");
          chunkBytes = Number.parseInt(line, 16);
          if (chunkBytes === 0) {
            finish();
            return;
          }
        }
        const size = Math.min(chunkBytes, pending.length);
        if (size === 0) return;
        emit(size);
        chunkBytes -= size;
        if (chunkBytes === 0) {
          chunkBytes = undefined;
          chunkTerminator = true;
        }
      }
      if (remoteEnded && pending.length === 0 && !ended) {
        if (chunked || (remaining !== undefined && remaining !== 0))
          throw new Error("Guest response ended early.");
        finish();
      }
    };
    stream.onData = (bytes) => {
      if (ended) return;
      const next = new Uint8Array(pending.length + bytes.length);
      next.set(pending);
      next.set(bytes, pending.length);
      pending = next;
      if (pending.length > MAX_BUFFERED_BYTES) {
        fail(new Error("Guest response buffer is full."));
        return;
      }
      try {
        pump();
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Invalid guest response."));
      }
    };
    stream.onEnd = () => {
      if (ended) return;
      remoteEnded = true;
      if (!controller) {
        fail(new Error("Guest response ended early."));
        return;
      }
      try {
        pump();
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Invalid guest response."));
      }
    };
    stream.onClose = (error) => {
      if (error) fail(error);
      else stream.onEnd();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    const write = (bytes: Uint8Array) =>
      new Promise<void>((resolve, reject) => {
        try {
          stream.write(bytes, (error) => (error ? reject(error) : resolve()));
        } catch (error) {
          reject(error);
        }
      });
    const send = async () => {
      await write(head);
      for (let offset = 0; offset < body.length; offset += 64 * 1024) {
        if (ended) break;
        await write(body.subarray(offset, offset + 64 * 1024));
      }
      if (!ended) stream.end();
    };
    void send().catch((error) =>
      fail(error instanceof Error ? error : new Error("Guest request failed.")),
    );
  });
}
