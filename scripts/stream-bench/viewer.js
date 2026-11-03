// readMarker decodes the marker workload.html draws; its layout and encoding are described there.
const params = new URLSearchParams(location.search);
const width = Number(params.get("width"));
const height = Number(params.get("height"));
const canvas = document.querySelector("canvas");
canvas.style.width = `${width}px`;
canvas.style.height = `${height}px`;

const emptyRun = () => ({
  recording: false,
  startedAt: 0,
  receivedFrames: 0,
  receivedBytes: 0,
  paintLatencies: [],
  staleFrames: 0,
  first: null,
  echoes: [],
  misreads: 0,
});
let run = emptyRun();
let viewport = null;
let newest = null;
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
  const marker = readMarker();
  if (!marker) {
    if (run.recording) run.misreads++;
    return;
  }
  // The frame counter is 16 bits, so progress is the forward distance modulo 2^16.
  const step = newest === null ? 1 : (marker.frame - newest.frame) & 0xffff;
  if (step === 0) return;
  if (step >= 0x8000) {
    if (run.recording) run.staleFrames++;
    return;
  }
  newest = marker;
  if (!run.recording) return;
  run.first ??= marker;
  run.paintLatencies.push(latency(marker.ms, at));
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
      if (run.recording) {
        run.receivedFrames++;
        run.receivedBytes += jpeg.byteLength;
      }
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

const sourceFps = () => {
  if (run.first === null || newest === run.first) return null;
  const frames = (newest.frame - run.first.frame) & 0xffff;
  const ms = (newest.ms - run.first.ms) & 0xffffff;
  return ms > 0 ? (frames * 1000) / ms : null;
};

globalThis.bench = {
  isReady: () => ready && echo.readyState === WebSocket.OPEN,
  start: () => {
    run = { ...emptyRun(), recording: true, startedAt: Date.now() };
  },
  stop: () => {
    run.recording = false;
    client.stop();
    painter.stop();
    echo.close();
    return {
      durationMs: Date.now() - run.startedAt,
      receivedFrames: run.receivedFrames,
      receivedBytes: run.receivedBytes,
      paintLatencies: run.paintLatencies,
      staleFrames: run.staleFrames,
      sourceFps: sourceFps(),
      echoes: run.echoes,
      misreads: run.misreads,
    };
  },
};
