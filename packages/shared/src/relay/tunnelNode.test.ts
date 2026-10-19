// @effect-diagnostics nodeBuiltinImport:off - verifies loopback request boundaries on real TCP sockets.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import type * as NodeStream from "node:stream";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { TunnelStream } from "./tunnel.ts";
import { openLoopbackRelay } from "./tunnelNode.ts";

const { open } = vi.hoisted(() => ({ open: vi.fn<() => Promise<TunnelStream>>() }));
vi.mock("./tunnel.ts", () => ({ createTunnelConnector: () => ({ open, close: () => {} }) }));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
  open.mockReset();
});

async function fixture(upgrade = false) {
  const requests: Array<{ target: string; host: string | undefined; body: string }> = [];
  const upgradeBytes: Buffer[] = [];
  const trailers: NodeHttp.IncomingHttpHeaders[] = [];
  const upgraded = new Set<NodeStream.Duplex>();
  const server = NodeHttp.createServer(async (request, response) => {
    const received = { target: request.url!, host: request.headers.host, body: "" };
    requests.push(received);
    const body: Buffer[] = [];
    for await (const bytes of request) body.push(bytes);
    if (Object.keys(request.trailers).length > 0) trailers.push(request.trailers);
    received.body = Buffer.concat(body).toString();
    response.writeHead(200, { "content-length": 0 });
    response.end();
  });
  server.on("upgrade", (request, socket, head) => {
    upgraded.add(socket);
    socket.once("close", () => upgraded.delete(socket));
    requests.push({ target: request.url!, host: request.headers.host, body: "" });
    if (head.length > 0) upgradeBytes.push(head);
    socket.on("data", (bytes: Buffer) => {
      upgradeBytes.push(bytes);
      socket.end(bytes);
    });
    socket.write("HTTP/1.1 103 Early Hints\r\n\r\n", () => {
      socket.write(
        upgrade
          ? "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"
          : "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n",
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No host listener");
  cleanups.push(async () => {
    server.closeAllConnections();
    for (const socket of upgraded) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  open.mockImplementation(async () => {
    const socket = NodeNet.connect(address.port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const stream: TunnelStream = {
      id: 1,
      write: (data, sent) => socket.write(data, (error) => sent?.(error ?? undefined)),
      end: () => socket.end(),
      reset: () => socket.destroy(),
      consumed: () => {},
      onData: () => {},
      onEnd: () => {},
      onClose: () => {},
    };
    socket.on("data", (data) => stream.onData(data));
    socket.once("end", () => stream.onEnd());
    socket.once("error", (error) => stream.onClose(error));
    return stream;
  });
  const gateway = await openLoopbackRelay("https://relay.supaterm.alt", {
    randomBytes: (length) => new Uint8Array(length),
    createSocket: () => {
      throw new Error("Unexpected relay dial");
    },
  });
  cleanups.push(gateway.close);
  const authority = new URL(gateway.origin).host;
  const socket = NodeNet.connect(Number(new URL(gateway.origin).port), "127.0.0.1");
  socket.on("error", () => {});
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.resume();
  cleanups.push(async () => {
    socket.destroy();
  });
  return { socket, authority, requests, upgradeBytes, trailers };
}

it.each(["foreign host", "duplicate host", "absolute target"])(
  "rejects a second keep-alive request with a %s",
  async (invalid) => {
    const { socket, authority, requests } = await fixture();
    const first = new Promise<Buffer>((resolve) => socket.once("data", resolve));
    socket.write(`GET /first HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    expect(String(await first)).toContain("200 OK");
    const target = invalid === "absolute target" ? "http://elsewhere.invalid/second" : "/second";
    const host = invalid === "foreign host" ? "elsewhere.invalid" : authority;
    const duplicate = invalid === "duplicate host" ? "Host: elsewhere.invalid\r\n" : "";
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    socket.write(
      `GET ${target} HTTP/1.1\r\nHost: ${host}\r\n${duplicate}Connection: close\r\n\r\n`,
    );
    await closed;
    expect(requests).toEqual([{ target: "/first", host: authority, body: "" }]);
  },
);

it("preserves fragmented chunked bodies, trailers, and following keep-alive requests", async () => {
  const { socket, authority, requests, trailers } = await fixture();
  const first = new Promise<Buffer>((resolve) => socket.once("data", resolve));
  for (const part of [
    `POST /upload HTTP/1.1\r\nHost: ${authority}\r\nTransfer-Encoding: chunked\r\n\r\n`,
    "3\r\n",
    "a",
    "bc\r\n0\r\nX-Checksum: done\r\n\r\n",
  ])
    socket.write(part);
  expect(String(await first)).toContain("200 OK");
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  socket.write(`GET /next HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`);
  await closed;
  expect(requests).toEqual([
    { target: "/upload", host: authority, body: "abc" },
    { target: "/next", host: authority, body: "" },
  ]);
  expect(trailers).toEqual([{ "x-checksum": "done" }]);
});

it("preserves a fixed-length body containing request-like bytes before a pipelined request", async () => {
  const { socket, authority, requests } = await fixture();
  const body = "GET /foreign HTTP/1.1\r\nHost: elsewhere.invalid\r\n\r\n";
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  socket.end(
    `POST /upload HTTP/1.1\r\nHost: ${authority}\r\nContent-Length: ${body.length}\r\n\r\n${body}` +
      `GET /next HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`,
  );
  await closed;
  expect(requests).toEqual([
    { target: "/upload", host: authority, body },
    { target: "/next", host: authority, body: "" },
  ]);
});

it("closes an idle half-closed client without opening a tunnel", async () => {
  const { socket } = await fixture();
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  socket.end();
  await closed;
  expect(open).not.toHaveBeenCalled();
});

it.each([true, false])(
  "forwards early upgrade bytes only after acceptance=%s",
  async (accepted) => {
    const { socket, authority, upgradeBytes } = await fixture(accepted);
    const responses: Buffer[] = [];
    socket.on("data", (data: Buffer) => responses.push(data));
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    const early = accepted
      ? "early opaque bytes"
      : "GET /foreign HTTP/1.1\r\nHost: elsewhere.invalid\r\n\r\n";
    socket.end(
      `GET /ws HTTP/1.1\r\nHost: ${authority}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n${early}`,
    );
    await closed;
    expect(Buffer.concat(upgradeBytes).toString()).toBe(accepted ? early : "");
    if (accepted) {
      expect(Buffer.concat(responses).toString()).toContain("101 Switching Protocols");
      expect(Buffer.concat(responses).toString().endsWith(early)).toBe(true);
    }
  },
);

it("rejects a complete oversized first header before dialing a tunnel", async () => {
  const { socket, authority, requests } = await fixture();
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  socket.end(`GET / HTTP/1.1\r\nHost: ${authority}\r\nX-Large: ${"a".repeat(16384)}\r\n\r\n`);
  await closed;
  expect(open).not.toHaveBeenCalled();
  expect(requests).toEqual([]);
});
