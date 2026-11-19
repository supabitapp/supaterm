// @effect-diagnostics nodeBuiltinImport:off - isolated native interoperability fixture.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeReadline from "node:readline";
import WebSocket, { WebSocketServer } from "ws";
import { relayHttpBaseUrl, relayPublicKey } from "@supaterm/shared/relay/protocol";
import { TunnelSocket, openLoopbackRelay } from "@supaterm/shared/relay/tunnelNode";
import { startRelayTransport } from "../transport.ts";
import { isRelayPath } from "../RelayIngress.ts";

async function startRelay(port = 0) {
  const binary = process.env.RELAY_TEST_BINARY;
  if (!binary) throw new Error("Set RELAY_TEST_BINARY to a compiled supacode-relay binary.");
  const child = NodeChildProcess.spawn(binary, [], {
    env: {
      ...process.env,
      RELAY_ADDR: `127.0.0.1:${port}`,
      RELAY_PRIVATE_ADDR: "",
      RELAY_ROUTERS: "",
      RELAY_NODE_ID: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (data: Buffer) => {
    errors += data.toString();
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const address = await new Promise<string>((resolve, reject) => {
    const lines = NodeReadline.createInterface({ input: child.stdout });
    child.once("error", reject);
    child.once("exit", () => reject(new Error(`Relay exited: ${errors}`)));
    lines.on("line", (line) => {
      const event = JSON.parse(line) as { event?: string; address?: string };
      if (event.event === "listening" && event.address) {
        lines.close();
        resolve(event.address);
      }
    });
  });
  return {
    url: `ws://${address}`,
    port: Number(address.split(":").at(-1)),
    async stop() {
      child.kill("SIGTERM");
      await exited;
    },
  };
}

async function startFixtureHost(relayUrl: string, secret = NodeCrypto.randomBytes(32)) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfWQAAAAASUVORK5CYII=",
    "base64",
  );
  const videoSize = 20 * 1024 * 1024;
  let streams = 0;
  const sockets = new Set<TunnelSocket>();
  const upgrades = new WebSocketServer({ noServer: true });
  const server = NodeHttp.createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    const url = new URL(request.url!, "http://fixture");
    if (!isRelayPath(url.pathname)) {
      response.writeHead(404).end();
      return;
    }
    if (url.pathname === "/.well-known/supaterm/environment") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ environmentId: "relay-interop-environment" }));
      return;
    }
    if (url.pathname === "/oauth/token") {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      if (new URLSearchParams(body).get("subject_token") !== "fixture-bootstrap") {
        response.writeHead(401).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ access_token: "fixture-bearer" }));
      return;
    }
    if (url.pathname.startsWith("/api/auth/")) {
      if (request.headers.authorization !== "Bearer fixture-bearer") {
        response.writeHead(401).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          url.pathname.endsWith("websocket-ticket")
            ? { ticket: "fixture-ticket" }
            : { authenticated: true, remoteAddress: request.socket.remoteAddress },
        ),
      );
      return;
    }
    if (url.pathname === "/api/test/site/index.html") {
      response.setHeader("content-type", "text/html");
      response.setHeader("content-security-policy", "sandbox allow-scripts");
      response.end(
        '<link rel="stylesheet" href="style.css"><script src="app.js"></script><img src="img/logo.png">',
      );
      return;
    }
    if (url.pathname.endsWith("style.css")) {
      response.setHeader("content-type", "text/css");
      response.end("body{width:123px}");
      return;
    }
    if (url.pathname.endsWith("app.js")) {
      response.setHeader("content-type", "text/javascript");
      response.end(
        'console.log("script ran"); addEventListener("load", () => parent.postMessage({kind:"relay-browser-fixture", width:getComputedStyle(document.body).width, imageWidth:document.querySelector("img").naturalWidth}, "*"))',
      );
      return;
    }
    if (url.pathname.endsWith(".png")) {
      response.setHeader("content-type", "image/png");
      response.end(png);
      return;
    }
    if (url.pathname.endsWith("stream.mjpeg")) {
      response.setHeader("content-type", "multipart/x-mixed-replace; boundary=frame");
      for (let i = 0; i < 10; i++) {
        response.write(
          Buffer.concat([
            Buffer.from("--frame\r\nContent-Type: image/jpeg\r\n\r\n"),
            Buffer.from([255, 216, 255, 217]),
            Buffer.from("\r\n"),
          ]),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      response.end();
      return;
    }
    if (url.pathname === "/api/test/upload") {
      let size = 0;
      for await (const data of request) size += data.length;
      response.end(String(size));
      return;
    }
    if (url.pathname === "/api/test/video" || url.pathname === "/api/test/blob") {
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
      const size = range ? Number(range[2]) - Number(range[1]) + 1 : videoSize;
      if (range) {
        response.statusCode = 206;
        response.setHeader("content-range", `bytes ${range[1]}-${range[2]}/${videoSize}`);
      }
      response.setHeader("content-type", "video/mp4");
      response.setHeader("content-length", size);
      for (let offset = 0; offset < size; offset += 65536) {
        if (response.destroyed) return;
        if (!response.write(Buffer.alloc(Math.min(size - offset, 65536), 7)))
          await new Promise<void>((resolve) => {
            const done = () => {
              response.off("drain", done);
              response.off("close", done);
              resolve();
            };
            response.once("drain", done);
            response.once("close", done);
          });
      }
      response.end();
      return;
    }
    response.writeHead(404).end();
  });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url!, "http://fixture");
    if (url.pathname !== "/ws" && !url.pathname.startsWith("/api/device-hub/")) {
      socket.destroy();
      return;
    }
    upgrades.handleUpgrade(request, socket, head, (socket) =>
      socket.on("message", (data, binary) => socket.send(data, { binary })),
    );
  });
  let registered!: () => void;
  const ready = new Promise<void>((resolve) => {
    registered = resolve;
  });
  const stopTransport = startRelayTransport({
    secret,
    relayUrl,
    retryBaseMs: 10,
    onStatus: (state) => {
      if (state === "registered") registered();
    },
    acceptStream: (stream) => {
      streams++;
      const socket = new TunnelSocket(stream);
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      server.emit("connection", socket);
    },
  });
  await ready;
  return {
    address: relayHttpBaseUrl(relayPublicKey(secret)),
    secret,
    streams: () => streams,
    async stop() {
      stopTransport();
      for (const socket of sockets) socket.destroy();
      upgrades.close();
      server.close();
    },
  };
}

export async function startNativeFixture() {
  let relay = await startRelay();
  let host = await startFixtureHost(relay.url);
  const identity = host.secret;
  const client = await openLoopbackRelay(host.address, {
    relayUrl: relay.url,
    randomBytes: NodeCrypto.randomBytes,
    createSocket: (url) => new WebSocket(url),
  });
  const config = {
    relayUrl: relay.url,
    address: host.address,
    authAddress: host.address,
    pairingUrl: host.address + "#token=fixture-bootstrap",
    nodeOrigin: client.origin,
    image: "/api/test/image.png",
    video: "/api/test/video",
    html: "/api/test/site/index.html",
  };
  return {
    config,
    async command(op: string) {
      if (op === "restartRelay") {
        await host.stop();
        await relay.stop();
        relay = await startRelay(relay.port);
        host = await startFixtureHost(relay.url, identity);
      }
      if (op === "restartHost") {
        await host.stop();
        host = await startFixtureHost(relay.url, identity);
      }
      if (op === "nodeCPU") return process.cpuUsage();
      return { ok: true };
    },
    async stop() {
      await client.close();
      await host.stop();
      await relay.stop();
    },
    streams: () => host.streams(),
  };
}
