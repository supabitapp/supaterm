// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalConsole:off - A byte-level TCP proxy driven by Node sockets and timers.
// One shared server-to-client link of --mbps plus --rtt/2 delay each way. --queue-kib 0 queues
// without bound (a bufferbloated path); otherwise reading from the server pauses at that backlog,
// so TCP pushes back into the server. Standalone: --target 127.0.0.1:PORT --mbps 10 --rtt 40.
import * as NodeNet from "node:net";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeUtil from "node:util";

const { values } = NodeUtil.parseArgs({
  options: {
    target: { type: "string" },
    mbps: { type: "string", default: "0" },
    rtt: { type: "string", default: "0" },
    "queue-kib": { type: "string", default: "0" },
  },
});
const [targetHost, targetPort] = (values.target ?? "").split(":");
if (!targetHost || !targetPort) throw new Error("--target host:port is required");
const bytesPerMs = (Number(values.mbps) * 1e6) / 8 / 1000;
const oneWayMs = Number(values.rtt) / 2;
const queueLimit = Number(values["queue-kib"]) * 1024;
// Sliced so a large read does not hold back the first bytes behind its own tail.
const SLICE = 4096;

const now = () => NodePerfHooks.performance.now();

interface Delivery {
  readonly at: number;
  readonly socket: NodeNet.Socket;
  readonly data: Buffer | null;
}
const downstream: Array<Delivery> = [];
const upstream: Array<Delivery> = [];
const serializing: Array<{ readonly doneAt: number; readonly bytes: number }> = [];
const serverSockets = new Set<NodeNet.Socket>();
let linkFreeAt = 0;
let queued = 0;
let paused = false;

const stats = { since: now(), queueMax: 0, delivered: 0 };
const setQueued = (next: number) => {
  queued = next;
  stats.queueMax = Math.max(stats.queueMax, queued);
};

let timer: ReturnType<typeof setTimeout> | null = null;
const schedule = () => {
  if (timer !== null) clearTimeout(timer);
  const next = Math.min(
    serializing[0]?.doneAt ?? Infinity,
    downstream[0]?.at ?? Infinity,
    upstream[0]?.at ?? Infinity,
  );
  timer = next === Infinity ? null : setTimeout(drain, Math.max(0, next - now()));
};
const deliver = (queue: Array<Delivery>, time: number) => {
  while (queue.length > 0 && queue[0]!.at <= time) {
    const { socket, data } = queue.shift()!;
    if (socket.destroyed) continue;
    if (data === null) socket.end();
    else socket.write(data);
  }
};
function drain() {
  timer = null;
  const time = now();
  let released = 0;
  while (serializing.length > 0 && serializing[0]!.doneAt <= time)
    released += serializing.shift()!.bytes;
  if (released > 0) setQueued(queued - released);
  deliver(upstream, time);
  for (const delivery of downstream) {
    if (delivery.at > time) break;
    stats.delivered += delivery.data?.length ?? 0;
  }
  deliver(downstream, time);
  if (paused && queued < queueLimit) {
    paused = false;
    for (const socket of serverSockets) socket.resume();
  }
  schedule();
}

const sendDown = (socket: NodeNet.Socket, data: Buffer | null) => {
  const time = now();
  if (data === null) {
    downstream.push({ at: Math.max(linkFreeAt, time) + oneWayMs, socket, data });
    schedule();
    return;
  }
  for (let offset = 0; offset < data.length; offset += SLICE) {
    const slice = data.subarray(offset, offset + SLICE);
    linkFreeAt = bytesPerMs > 0 ? Math.max(linkFreeAt, time) + slice.length / bytesPerMs : time;
    serializing.push({ doneAt: linkFreeAt, bytes: slice.length });
    downstream.push({ at: linkFreeAt + oneWayMs, socket, data: slice });
  }
  setQueued(queued + data.length);
  if (queueLimit > 0 && queued >= queueLimit && !paused) {
    paused = true;
    for (const server of serverSockets) server.pause();
  }
  schedule();
};
const sendUp = (socket: NodeNet.Socket, data: Buffer | null) => {
  upstream.push({ at: now() + oneWayMs, socket, data });
  schedule();
};

const listener = NodeNet.createServer({ noDelay: true }, (client) => {
  const server = NodeNet.connect({ host: targetHost, port: Number(targetPort), noDelay: true });
  serverSockets.add(server);
  if (paused) server.pause();
  const close = () => {
    serverSockets.delete(server);
    client.destroy();
    server.destroy();
  };
  client.on("data", (data) => sendUp(server, data));
  client.on("end", () => sendUp(server, null));
  server.on("data", (data) => sendDown(client, data));
  server.on("end", () => sendDown(client, null));
  client.on("error", close);
  server.on("error", close);
  client.on("close", close);
  server.on("close", () => {
    serverSockets.delete(server);
  });
});

process.on("message", (request: { readonly id: number; readonly type: "mark" | "collect" }) => {
  if (request.type === "mark") {
    Object.assign(stats, { since: now(), queueMax: queued, delivered: 0 });
    process.send?.({ id: request.id, result: {} });
    return;
  }
  const elapsed = now() - stats.since;
  process.send?.({
    id: request.id,
    result: {
      queueMaxKiB: stats.queueMax / 1024,
      deliveredMbps: (stats.delivered * 8) / 1000 / Math.max(1, elapsed),
    },
  });
});

process.once("disconnect", () => process.exit(0));
listener.listen(0, "127.0.0.1", () => {
  const { port } = listener.address() as NodeNet.AddressInfo;
  if (process.send) process.send({ id: 0, result: { port } });
  else console.log(`listening on 127.0.0.1:${port}`);
});
