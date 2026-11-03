// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalConsole:off - A raw WebSocket server paced by Node timers.
// Stands in for serve-emu's video socket: 8 Mbps of 60 fps frame-meta packets (pts = send time in
// µs), behind serve-emu's guard (dist/server.js): past 512 KiB buffered it drops until a keyframe,
// past 16 MiB it closes.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodePerfHooks from "node:perf_hooks";

const MBPS = 8;
const FPS = 60;
const KEYFRAME_EVERY = 60;
const KEYFRAME_SCALE = 4;
const deltaBytes = Math.round(
  (MBPS * 1e6) / 8 / (FPS * (1 + (KEYFRAME_SCALE - 1) / KEYFRAME_EVERY)),
);
// serve-emu's dist/server.js constants.
const DROP_FRAME_BUFFERED_BYTES = 512 * 1024;
const CLOSE_CLIENT_BUFFERED_BYTES = 16 * 1024 * 1024;
const VIDEO_RESET_COOLDOWN_MS = 500;
const SEMU_MAGIC = 0x53454d55;
const HEADER_BYTES = 16;
const filler = NodeCrypto.randomBytes(deltaBytes * KEYFRAME_SCALE);

const now = () => NodePerfHooks.performance.timeOrigin + NodePerfHooks.performance.now();

const stats = {
  sentFrames: 0,
  droppedFrames: 0,
  dropEvents: 0,
  slowCloses: 0,
  maxBuffered: 0,
};

const wsFrame = (opcode: number, payload: Buffer) => {
  const length = payload.length;
  const header =
    length < 126
      ? Buffer.from([0x80 | opcode, length])
      : length < 65536
        ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
        : Buffer.concat([Buffer.from([0x80 | opcode, 127]), bigEndian64(length)]);
  return Buffer.concat([header, payload]);
};
const bigEndian64 = (value: number) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
};

const stream = (socket: NodeNet.Socket) => {
  let open = true;
  const start = now();
  let sequence = 0;
  let sinceKey = 0;
  let awaitingKeyFrame = false;
  let forceKey = false;
  let lastReset = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    open = false;
    if (timer !== null) clearTimeout(timer);
  };
  socket.on("close", stop);
  socket.on("error", stop);
  socket.on("data", () => undefined);
  const dropUntilKeyFrame = (time: number) => {
    stats.droppedFrames++;
    stats.dropEvents++;
    awaitingKeyFrame = true;
    if (time - lastReset >= VIDEO_RESET_COOLDOWN_MS) {
      lastReset = time;
      forceKey = true;
    }
  };
  const tick = () => {
    if (!open) return;
    const time = now();
    const isKey = forceKey || sinceKey % KEYFRAME_EVERY === 0;
    if (isKey) {
      forceKey = false;
      sinceKey = 0;
    }
    sinceKey++;
    const buffered = socket.writableLength;
    stats.maxBuffered = Math.max(stats.maxBuffered, buffered);
    if (awaitingKeyFrame && !isKey) {
      stats.droppedFrames++;
    } else if (buffered > CLOSE_CLIENT_BUFFERED_BYTES) {
      stats.slowCloses++;
      socket.end(wsFrame(0x8, Buffer.from([0x03, 0xf5])));
      stop();
      return;
    } else if (buffered > DROP_FRAME_BUFFERED_BYTES) {
      dropUntilKeyFrame(time);
    } else {
      awaitingKeyFrame = false;
      const payload = filler.subarray(0, HEADER_BYTES + deltaBytes * (isKey ? KEYFRAME_SCALE : 1));
      const packet = Buffer.from(payload);
      packet.writeUInt32BE(SEMU_MAGIC, 0);
      packet.writeUInt8(1, 4);
      packet.writeUInt8(isKey ? 1 : 0, 5);
      packet.writeUInt16BE(0, 6);
      packet.writeBigUInt64BE(BigInt(Math.round(time * 1000)), 8);
      packet.writeUInt32BE(sequence, HEADER_BYTES);
      socket.write(wsFrame(0x2, packet));
      stats.sentFrames++;
    }
    sequence++;
    // Node rounds timer delays to whole ms, so pace against the ideal schedule, not the last tick.
    timer = setTimeout(tick, Math.max(0, start + (sequence * 1000) / FPS - now()));
  };
  tick();
};

const server = NodeHttp.createServer((_request, response) => {
  response.writeHead(404).end();
});
server.on("upgrade", (request, socket: NodeNet.Socket) => {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  const accept = NodeCrypto.createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.setNoDelay(true);
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  stream(socket);
});

process.on("message", (request: { readonly id: number; readonly type: "mark" | "collect" }) => {
  if (request.type === "mark") {
    Object.assign(stats, {
      sentFrames: 0,
      droppedFrames: 0,
      dropEvents: 0,
      slowCloses: 0,
      maxBuffered: 0,
    });
  }
  process.send?.({ id: request.id, result: request.type === "collect" ? stats : {} });
});

process.once("disconnect", () => process.exit(0));
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address() as NodeNet.AddressInfo;
  if (process.send) process.send({ id: 0, result: { port } });
  else console.log(`hub on ws://127.0.0.1:${port}/vendor/serve-emu/ws`);
});
