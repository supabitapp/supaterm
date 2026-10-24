// Until the viewer answers a ping, only one frame is in flight; older clients never do.

const MAX_FRAMES_IN_FLIGHT = 8;
const RTT_WINDOW_MS = 10_000;
const RATE_WINDOW_MS = 1_500;
const RATE_SAMPLES_KEPT = 4;
const MIN_ACK_GAP_MS = 4;
const PACING_SLACK_MS = 2;
const MIN_QUEUE_DELAY_MS = 25;
// Pacing below the delivery rate drains a standing queue without stalling the stream.
const DRAIN_GAIN = 0.75;

interface WireFrame {
  readonly bytes: number;
  readonly sentAt: number;
  readonly behind: boolean;
}

export const make = () => {
  const wire: Array<WireFrame> = [];
  const rtts: Array<readonly [at: number, rtt: number]> = [];
  const rates: Array<readonly [at: number, bytesPerMs: number]> = [];
  let wireBytes = 0;
  let pathRtt = Number.POSITIVE_INFINITY;
  let lastAckAt = 0;
  let busyUntil = 0;
  let queueDelay = 0;

  const probed = () => Number.isFinite(pathRtt);
  const minRtt = () => rtts.reduce((min, [, rtt]) => Math.min(min, rtt), pathRtt);
  const rate = () => rates.reduce((max, [, bytesPerMs]) => Math.max(max, bytesPerMs), 0);
  const congested = () => queueDelay > Math.max(MIN_QUEUE_DELAY_MS, minRtt() / 4);
  const recordRtt = (now: number, rtt: number) => {
    rtts.push([now, rtt]);
    while (rtts.length > 1 && rtts[0]![0] < now - RTT_WINDOW_MS) rtts.shift();
  };
  const windowOpen = (bytes: number) => {
    const bytesPerMs = rate();
    return (
      probed() &&
      bytesPerMs > 0 &&
      wire.length < MAX_FRAMES_IN_FLIGHT &&
      wireBytes <= 2 * bytesPerMs * minRtt() + bytes
    );
  };

  return {
    idle: () => wire.length === 0,
    canSend: (now: number, bytes: number) =>
      wire.length === 0 || (windowOpen(bytes) && now >= busyUntil - PACING_SLACK_MS),
    /** When a frame blocked only by pacing may go, or null when it waits on an ack. */
    wakeAt: (now: number, bytes: number) => {
      const at = busyUntil - PACING_SLACK_MS;
      return wire.length > 0 && at > now && windowOpen(bytes) ? at : null;
    },
    sent: (now: number, bytes: number) => {
      const bytesPerMs = rate();
      wire.push({ bytes, sentAt: now, behind: wire.length > 0 });
      wireBytes += bytes;
      const pace = bytesPerMs * (congested() ? DRAIN_GAIN : 1);
      busyUntil = Math.max(now, busyUntil) + (pace > 0 ? bytes / pace : 0);
    },
    /** Acks arrive in send order, one per frame. */
    acked: (now: number) => {
      const frame = wire.shift();
      if (!frame) return;
      wireBytes -= frame.bytes;
      const roundTrip = now - frame.sentAt;
      recordRtt(now, roundTrip);
      const current = rate();
      // A frame that serializes faster than acks can be timed says nothing about the rate.
      if (probed() && (current === 0 || frame.bytes / current >= MIN_ACK_GAP_MS)) {
        const min = minRtt();
        // Both the time past the path delay and, behind another frame, the gap
        // after its ack are at least this frame's serialization, so the
        // shorter one is the tighter bound on the rate.
        const pastPath = roundTrip - min;
        const interval = Math.max(
          MIN_ACK_GAP_MS,
          frame.behind ? Math.min(now - lastAckAt, pastPath) : pastPath,
        );
        const delivered = Math.min(frame.bytes / interval, current > 0 ? 2 * current : Infinity);
        // A frame sent with nothing ahead of it was held back by the page, not
        // the link, so it may raise the estimate but never lower it.
        if (frame.behind || delivered > current) {
          rates.push([now, delivered]);
          while (rates.length > RATE_SAMPLES_KEPT && rates[0]![0] < now - RATE_WINDOW_MS) {
            rates.shift();
          }
        }
        const bytesPerMs = rate();
        queueDelay = roundTrip - min - frame.bytes / bytesPerMs;
        if (congested()) rates.splice(0, rates.length - 1);
      }
      lastAckAt = now;
    },
    /**
     * A ping answered with nothing queued ahead of it measures the path alone.
     * Frames keep the link busy, so the last one stands until the next.
     */
    probed: (rtt: number) => {
      pathRtt = rtt;
    },
  };
};
