// @effect-diagnostics nodeBuiltinImport:off - Spawns the synthetic hub child by path.
import * as NodePath from "node:path";

import {
  linkMetrics,
  queueName,
  serverMetrics,
  sleep,
  spawnChild,
  startServer,
  startShaper,
  wallNow,
  within,
  type Link,
  type RunConfig,
} from "./runner.ts";
import { median, percentile, round, slope, spread, type Aggregate } from "./stats.ts";

export interface DeviceCell {
  readonly target: "device";
  readonly link: Link;
}
export const deviceCellName = (cell: DeviceCell) => `${cell.link.name} ${queueName(cell.link)}`;

interface HubStats {
  readonly sentFrames: number;
  readonly droppedFrames: number;
  readonly dropEvents: number;
  readonly slowCloses: number;
  readonly maxBuffered: number;
}

const SEMU_MAGIC = 0x53454d55;

export const runDevice = async (
  scope: AsyncDisposableStack,
  cell: DeviceCell,
  config: RunConfig,
) => {
  const hub = await spawnChild<{ readonly port: number }, { mark: object; collect: HubStats }>(
    scope,
    NodePath.join(import.meta.dirname, "hub.ts"),
    [],
  );
  const server = await startServer<{ readonly port: number }>(scope, config, [
    `--hub-origin=http://127.0.0.1:${hub.ready.port}`,
  ]);
  const shaper = await startShaper(scope, cell.link, server.ready.port);
  const origin = `127.0.0.1:${shaper?.ready.port ?? server.ready.port}`;
  const frames: Array<readonly [time: number, age: number]> = [];
  let bytes = 0;
  let sequenceGaps = 0;
  let lastSequence: number | null = null;
  let recording = false;
  let closedCode: number | null = null;
  const socket = new WebSocket(
    `ws://${origin}/api/device-hub/vendor/serve-emu/ws?device=bench&frame-meta=1&wsTicket=bench`,
  );
  scope.defer(() => socket.close());
  socket.binaryType = "arraybuffer";
  socket.addEventListener("message", (event) => {
    if (!recording || !(event.data instanceof ArrayBuffer)) return;
    const view = new DataView(event.data);
    if (event.data.byteLength < 20 || view.getUint32(0) !== SEMU_MAGIC) return;
    const time = wallNow();
    const sequence = view.getUint32(16);
    frames.push([time, time - Number(view.getBigUint64(8)) / 1000]);
    bytes += event.data.byteLength;
    if (lastSequence !== null) sequenceGaps += sequence - lastSequence - 1;
    lastSequence = sequence;
  });
  socket.addEventListener("close", (event) => {
    closedCode = event.code;
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("device socket failed")));
  });
  if (!(await within(opened, 30_000))) throw new Error("device socket did not open in 30 s");
  await opened;
  await sleep(config.warmupMs);
  await Promise.all([server.request("mark"), hub.request("mark"), shaper?.request("mark")]);
  recording = true;
  const startedAt = wallNow();
  await sleep(config.seconds * 1000);
  recording = false;
  const duration = (wallNow() - startedAt) / 1000;
  const [stats, hubStats, link] = await Promise.all([
    server.request("collect"),
    hub.request("collect"),
    shaper?.request("collect"),
  ]);
  const ages = frames.map(([, age]) => age);
  const window = (from: number, to: number) =>
    percentile(
      frames.flatMap(([time, age]) => (time >= from && time < to ? [age] : [])),
      0.5,
    );
  return {
    recvFps: round(frames.length / duration),
    mbps: round((bytes * 8) / 1e6 / duration, 2),
    ageP50: round(percentile(ages, 0.5)),
    ageMax: round(percentile(ages, 1)),
    ageFirst2s: round(window(startedAt, startedAt + 2000)),
    ageLast2s: round(window(startedAt + (duration - 2) * 1000, Infinity)),
    ageSlopeMsPerS: round(slope(frames.map(([time, age]) => [time / 1000, age] as const))),
    sequenceGaps,
    closedCode,
    ...serverMetrics(stats),
    nodeSocketBufferedMaxMB: round(stats.deviceBufferedMax / 1024 / 1024, 2),
    nodeSocketBufferedEndMB: round(stats.deviceBufferedEnd / 1024 / 1024, 2),
    hubSentFrames: hubStats.sentFrames,
    hubDroppedFrames: hubStats.droppedFrames,
    hubDropEvents: hubStats.dropEvents,
    hubSlowCloses: hubStats.slowCloses,
    hubMaxBufferedKiB: round(hubStats.maxBuffered / 1024),
    ...linkMetrics(cell.link, link),
  };
};
export type DeviceMetrics = Awaited<ReturnType<typeof runDevice>>;

export const deviceColumns = (stats: Aggregate<DeviceMetrics>) => ({
  "recv fps": median(stats, "recvFps"),
  Mbps: median(stats, "mbps"),
  "link util": median(stats, "linkUtil"),
  "age first->last 2s ms": `${median(stats, "ageFirst2s")}->${median(stats, "ageLast2s")}`,
  "age slope ms/s (range)": spread(stats, "ageSlopeMsPerS"),
  "rss start->end MB": `${median(stats, "rssStartMB")}->${median(stats, "rssEndMB")}`,
  "retained +MB (range)": spread(stats, "retainedGrowthMB"),
  "node sockbuf max/end MB": `${median(stats, "nodeSocketBufferedMaxMB")}/${median(stats, "nodeSocketBufferedEndMB")}`,
  "hub drops/closes": `${median(stats, "hubDropEvents")}/${median(stats, "hubSlowCloses")}`,
  "shaper q max KiB": median(stats, "linkQueueMaxKiB"),
});
