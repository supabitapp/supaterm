// Runs in the bench's viewer page next to the real client-runtime preview client (client.js).
// It reads the workload's marker back from the painted canvas; see workload.html for the layout.
const params = new URLSearchParams(location.search);
const width = Number(params.get("width"));
const height = Number(params.get("height"));
const canvas = document.querySelector("canvas");
canvas.style.width = `${width}px`;
canvas.style.height = `${height}px`;

// Tags each frame's bytes with its receipt time through the painter's Blob and decode, so a
// painted frame keeps the time it arrived without the painter exposing it.
const receivedAt = new WeakMap();
const blobReceivedAt = new WeakMap();
const NativeBlob = Blob;
globalThis.Blob = class extends NativeBlob {
  constructor(parts, options) {
    super(parts, options);
    const at = parts && receivedAt.get(parts[0]);
    if (at !== undefined) blobReceivedAt.set(this, at);
  }
};
const nativeCreateImageBitmap = createImageBitmap;
let decodedReceivedAt;
globalThis.createImageBitmap = async (source, ...rest) => {
  const at = blobReceivedAt.get(source);
  const bitmap = await nativeCreateImageBitmap(source, ...rest);
  decodedReceivedAt = at;
  return bitmap;
};

const run = {
  recording: false,
  startedAt: 0,
  received: [],
  painted: [],
  echoes: [],
  misreads: 0,
};
let viewport = null;
let lastFrame = -1;
const context = canvas.getContext("2d");

const latency = (ms, at) => {
  let value = (Math.floor(at) & 0xffffff) - ms;
  if (value < -0x800000) value += 0x1000000;
  return value;
};
const readMarker = () => {
  if (!viewport) return null;
  const scale = canvas.width / viewport.width;
  let low = 0;
  let high = 0;
  for (let row = 0; row < 3; row++) {
    const y = Math.round((150 + row * 24 + 12) * scale);
    const strip = context.getImageData(Math.round(300 * scale), y, Math.ceil(384 * scale), 1).data;
    for (let col = 0; col < 16; col++) {
      const x = Math.round((col * 24 + 12) * scale) * 4;
      if (strip[x] + strip[x + 1] + strip[x + 2] <= 382) continue;
      const bit = row * 16 + col;
      if (bit < 24) low |= 1 << bit;
      else high |= 1 << (bit - 24);
    }
  }
  const frame = low & 0xffff;
  const ms = (low >>> 16) | ((high & 0xffff) << 8);
  const check = (high >>> 16) & 0xff;
  return check === ((frame ^ (frame >> 8) ^ ms ^ (ms >> 8) ^ (ms >> 16) ^ 0xa5) & 0xff)
    ? { frame, ms }
    : null;
};

const painter = previewStream.createPreviewFramePainter(canvas, () => {
  const at = Date.now();
  const arrived = decodedReceivedAt;
  if (!run.recording) return;
  const marker = readMarker();
  if (!marker) {
    run.misreads++;
    return;
  }
  if (marker.frame === lastFrame) return;
  lastFrame = marker.frame;
  run.painted.push([
    latency(marker.ms, at),
    arrived === undefined ? null : latency(marker.ms, arrived),
  ]);
});

let resized = false;
let ready = false;
const client = previewStream.createPreviewStreamClient(
  {
    access: {
      httpBase: params.get("http"),
      wsBase: params.get("ws"),
      query: { wsTicket: "bench" },
      credentials: false,
    },
    threadId: params.get("threadId"),
    tabId: params.get("tabId"),
    maxWidth: width * devicePixelRatio,
    maxHeight: height * devicePixelRatio,
  },
  {
    onFrame: (jpeg) => {
      const at = Date.now();
      receivedAt.set(jpeg, at);
      if (run.recording) run.received.push(jpeg.byteLength);
      painter.paint(jpeg);
    },
    onViewport: (next) => {
      viewport = next;
      ready = next.width === width && next.height === height;
    },
    onControl: (control) => {
      if (!control.canOperate) return;
      if (control.controller !== "you") client.send({ type: "takeControl" });
      else if (!resized) resized = client.send({ type: "resize", width, height });
    },
    onConnectedChange: () => undefined,
    onUnauthorized: () => undefined,
  },
);

if (params.get("kind") === "scroll") {
  // One wheel step per frame, as the web client coalesces wheel input per animation frame.
  requestAnimationFrame(function wheel() {
    if (ready)
      client.send({
        type: "wheel",
        x: width / 2,
        y: height / 2,
        deltaX: 0,
        deltaY: 8,
        modifiers: 0,
      });
    requestAnimationFrame(wheel);
  });
}

const echo = new WebSocket(params.get("echo"));
echo.addEventListener("open", () => {
  setInterval(() => echo.send(String(performance.now())), 100);
});
echo.addEventListener("message", (event) => {
  if (run.recording) run.echoes.push(performance.now() - Number(event.data));
});

globalThis.bench = {
  isReady: () => ready && echo.readyState === WebSocket.OPEN,
  start: () => {
    Object.assign(run, {
      recording: true,
      startedAt: Date.now(),
      received: [],
      painted: [],
      echoes: [],
      misreads: 0,
    });
  },
  stop: () => {
    run.recording = false;
    client.stop();
    painter.stop();
    echo.close();
    return { ...run, stoppedAt: Date.now() };
  },
};
