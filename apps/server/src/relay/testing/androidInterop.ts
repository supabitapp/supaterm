// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetch:off - JVM-native interoperability runner.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";
import * as NodePath from "node:path";
import * as NodeHttp from "node:http";
import WebSocket from "ws";
import { startNativeFixture } from "./relay.fixture.ts";

const fixture = await startNativeFixture();
const child = NodeChildProcess.spawn(
  NodePath.join(process.env.JAVA_HOME!, "bin/java"),
  [
    "-cp",
    process.env.KOTLIN_CLASSPATH!,
    "expo.modules.supatermrelaytunnel.core.MainKt",
    fixture.config.relayUrl,
    fixture.config.address,
  ],
  { stdio: ["pipe", "pipe", "inherit"] },
);
const exit = new Promise<void>((resolve) => child.once("exit", () => resolve()));
const lines = NodeReadline.createInterface({ input: child.stdout });
try {
  const origin = await new Promise<string>((resolve, reject) => {
    lines.on("line", (line) => {
      if (line.startsWith("READY ")) resolve(line.slice(6));
    });
    child.once("error", reject);
    child.once("exit", () => reject(new Error("JVM endpoint exited before READY")));
  });
  const get = async (path: string, init?: RequestInit) => {
    const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(30_000) });
    NodeAssert.ok(response.ok, `HTTP ${response.status} ${path}`);
    return response;
  };
  NodeAssert.equal((await get("/.well-known/supaterm/environment")).status, 200);
  NodeAssert.equal((await fetch(origin + "/api/auth/session")).status, 401);
  const exchange = await get("/oauth/token", {
    method: "POST",
    body: new URLSearchParams({ subject_token: "fixture-bootstrap" }),
  });
  const token = (await exchange.json()).access_token as string;
  NodeAssert.equal(
    (await get("/api/auth/session", { headers: { authorization: `Bearer ${token}` } })).status,
    200,
  );
  const html = await get(fixture.config.html);
  NodeAssert.match(await html.text(), /style.css/);
  NodeAssert.equal(html.headers.get("content-security-policy"), "sandbox allow-scripts");
  NodeAssert.match(await (await get("/api/test/site/style.css")).text(), /123px/);
  const image = new Uint8Array(await (await get(fixture.config.image)).arrayBuffer());
  NodeAssert.equal(image[0], 137);
  const range = await get(fixture.config.video, { headers: { range: "bytes=1048576-2097151" } });
  NodeAssert.equal(range.status, 206);
  NodeAssert.equal((await range.arrayBuffer()).byteLength, 1048576);
  NodeAssert.equal(range.headers.get("content-range"), "bytes 1048576-2097151/20971520");
  for (const route of ["/ws", "/api/device-hub/vendor/serve-sim/helper/ws"]) {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(origin.replace("http:", "ws:") + route);
      socket.once("open", () => socket.send("native-inner-websocket"));
      socket.once("message", (data) => {
        NodeAssert.equal(data.toString(), "native-inner-websocket");
        socket.close();
        resolve();
      });
      socket.once("error", reject);
    });
  }
  NodeAssert.equal(
    (await (await get("/api/test/blob")).arrayBuffer()).byteLength,
    20 * 1024 * 1024,
  );
  NodeAssert.equal(
    await (
      await get("/api/test/upload", { method: "POST", body: Buffer.alloc(20 * 1024 * 1024, 19) })
    ).text(),
    "20971520",
  );
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      NodeAssert.deepEqual(
        new Uint8Array(await (await get(fixture.config.image)).arrayBuffer()),
        image,
      );
    }),
  );
  await fixture.command("restartHost");
  NodeAssert.equal((await get(fixture.config.image)).status, 200);
  await fixture.command("restartRelay");
  NodeAssert.equal((await get(fixture.config.image)).status, 200);
  const milestone = new Promise<void>((resolve) =>
    lines.on("line", (line) => {
      if (line === "RESUMED") resolve();
    }),
  );
  child.stdin.write("suspend\nresume\n");
  await milestone;
  await new Promise<void>((resolve, reject) => {
    NodeHttp.get(origin + fixture.config.image, { agent: false }, (response) => {
      NodeAssert.equal(response.statusCode, 200);
      response.resume();
      response.once("end", resolve);
    }).once("error", reject);
  });
  console.log(
    "JVM native endpoint: auth, HTML siblings, video ranges, two WebSocket routes, 20 MiB upload/download, concurrency, host/relay restart and foreground recovery passed.",
  );
} finally {
  lines.close();
  child.stdin.write("stop\n");
  child.stdin.end();
  await exit;
  await fixture.stop();
}
