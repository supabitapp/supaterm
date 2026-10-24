import { describe, expect, it } from "@effect/vitest";

import * as PreviewStreamPacer from "./PreviewStreamPacer.ts";

const FRAME_INTERVAL_MS = 33;

// Chromium produces a frame every 33 ms and the newest supersedes the one
// waiting; the link serializes frames in order and acks return after the delay.
// Before `slowUntil`, frames come at a typing pace instead.
const simulate = (options: {
  readonly rttMs: number;
  readonly mbps: number;
  readonly frameBytes: number;
  readonly probed: boolean;
  readonly seconds?: number;
  readonly slowUntil?: number;
}) => {
  const pacer = PreviewStreamPacer.make();
  const bytesPerMs = (options.mbps * 1_000_000) / 8 / 1000;
  const oneWay = options.rttMs / 2;
  const end = (options.seconds ?? 6) * 1000;
  const delivered: Array<{ readonly receivedAt: number; readonly latency: number }> = [];
  const acks: Array<number> = [];
  let pending: number | null = null;
  let linkFreeAt = 0;
  let maxInFlight = 0;
  if (options.probed) pacer.probed(options.rttMs);
  for (let now = 0; now < end; now += 1) {
    if (now % (now < (options.slowUntil ?? 0) ? 100 : FRAME_INTERVAL_MS) === 0) pending = now;
    while (acks.length > 0 && acks[0]! <= now) {
      acks.shift();
      pacer.acked(now);
    }
    if (pending === null || !pacer.canSend(now, options.frameBytes)) continue;
    pacer.sent(now, options.frameBytes);
    linkFreeAt = Math.max(now, linkFreeAt) + options.frameBytes / bytesPerMs;
    const receivedAt = linkFreeAt + oneWay;
    delivered.push({ receivedAt, latency: receivedAt - pending });
    acks.push(Math.ceil(receivedAt + oneWay));
    maxInFlight = Math.max(maxInFlight, acks.length);
    pending = null;
  }
  const settled = delivered.filter((frame) => frame.receivedAt > end / 2 && frame.receivedAt < end);
  const latencies = settled.map((frame) => frame.latency).sort((a, b) => a - b);
  return {
    fps: settled.length / (end / 2 / 1000),
    p95: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
    maxInFlight,
  };
};

describe("PreviewStreamPacer", () => {
  it("keeps one frame in flight for viewers that never answer a ping", () => {
    const result = simulate({ rttMs: 200, mbps: 1000, frameBytes: 120_000, probed: false });
    expect(result.maxInFlight).toBe(1);
    expect(result.fps).toBeLessThanOrEqual(5);
  });

  it("keeps a long fast link busy instead of waiting a round trip per frame", () => {
    for (const rttMs of [40, 100, 200]) {
      const result = simulate({ rttMs, mbps: 1000, frameBytes: 120_000, probed: true });
      expect(result.fps).toBeGreaterThan(27);
      expect(result.p95).toBeLessThan(rttMs / 2 + 2 * FRAME_INTERVAL_MS);
    }
  });

  it("keeps up when frames speed up after a slow stretch", () => {
    const result = simulate({
      rttMs: 200,
      mbps: 1000,
      frameBytes: 120_000,
      probed: true,
      slowUntil: 3000,
    });
    expect(result.fps).toBeGreaterThan(27);
  });

  it("fills a slow link without building a queue behind it", () => {
    const frameBytes = 390_000;
    const serializationMs = frameBytes / ((20 * 1_000_000) / 8 / 1000);
    const result = simulate({ rttMs: 100, mbps: 20, frameBytes, probed: true, seconds: 10 });
    expect(result.fps).toBeGreaterThan(0.8 * (1000 / serializationMs));
    expect(result.p95).toBeLessThan(50 + 2 * serializationMs + 2 * FRAME_INTERVAL_MS);
  });

  it("waits for an ack until it knows the rate, then spaces frames by it", () => {
    const pacer = PreviewStreamPacer.make();
    pacer.probed(100);
    pacer.sent(0, 10_000);
    expect(pacer.canSend(0, 10_000)).toBe(false);
    expect(pacer.wakeAt(0, 10_000)).toBeNull();
    // 10 KB arrived 50 ms after the path delay: 200 bytes per ms.
    pacer.acked(150);
    pacer.sent(150, 10_000);
    expect(pacer.canSend(150, 10_000)).toBe(false);
    expect(pacer.wakeAt(150, 10_000)).toBe(198);
    expect(pacer.canSend(198, 10_000)).toBe(true);
  });
});
