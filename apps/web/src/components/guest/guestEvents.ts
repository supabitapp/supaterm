import {
  GUEST_STREAM_MAX_EVENT_BYTES,
  GUEST_STREAM_ERROR_EVENT,
  GuestStreamError,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import type { GuestTransport } from "./guestTransport";

const decodeStreamError = Schema.decodeUnknownOption(Schema.fromJsonString(GuestStreamError));

export function openGuestEvents(
  transport: GuestTransport,
  path: string,
  onMessage: (data: string) => void,
  onRejected: (reason?: GuestStreamError["reason"]) => void,
) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 500;
  const reject = (reason?: GuestStreamError["reason"]) => {
    abort.abort();
    onRejected(reason);
  };
  const connect = async () => {
    try {
      const response = await transport.request(path, { signal: abort.signal });
      if (!response.ok || !response.body) {
        reject();
        return;
      }
      retryMs = 500;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let frame = new Uint8Array(64 * 1024);
      const append = (bytes: Uint8Array) => {
        const needed = frameBytes + bytes.length;
        if (needed > frame.length) {
          const grown = new Uint8Array(
            Math.min(GUEST_STREAM_MAX_EVENT_BYTES, Math.max(needed, frame.length * 2)),
          );
          grown.set(frame.subarray(0, frameBytes));
          frame = grown;
        }
        frame.set(bytes, frameBytes);
        frameBytes = needed;
      };
      let frameBytes = 0;
      let previousNewline = false;
      try {
        while (!abort.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          let start = 0;
          for (let index = 0; index < value.length; index++) {
            if (frameBytes + index - start + 1 > GUEST_STREAM_MAX_EVENT_BYTES) {
              reject("event_too_large");
              return;
            }
            const newline = value[index] === 10;
            if (!newline || !previousNewline) {
              previousNewline = newline;
              continue;
            }
            append(value.subarray(start, index + 1));
            const lines = decoder.decode(frame.subarray(0, frameBytes)).slice(0, -2).split("\n");
            frameBytes = 0;
            previousNewline = false;
            start = index + 1;
            const data = lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (lines.some((line) => line === `event: ${GUEST_STREAM_ERROR_EVENT}`)) {
              const failure = decodeStreamError(data);
              reject(Option.isSome(failure) ? failure.value.reason : undefined);
              return;
            }
            if (data) onMessage(data);
            if (abort.signal.aborted) return;
          }
          if (start < value.length) {
            append(value.subarray(start));
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch {
      if (abort.signal.aborted) return;
    }
    if (!abort.signal.aborted) {
      timer = setTimeout(() => {
        void connect();
      }, retryMs);
      retryMs = Math.min(10_000, retryMs * 2);
    }
  };
  void connect();
  return {
    close() {
      abort.abort();
      clearTimeout(timer);
    },
  };
}
