import type { GuestTransport } from "./guestTransport";

export function openGuestEvents(
  transport: GuestTransport,
  path: string,
  onMessage: (data: string) => void,
  onRejected: () => void,
) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 500;
  const connect = async () => {
    try {
      const response = await transport.request(path, { signal: abort.signal });
      if (!response.ok || !response.body) {
        onRejected();
        return;
      }
      retryMs = 500;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      try {
        while (!abort.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          if (pending.length > 1024 * 1024) throw new Error("Guest event is too large.");
          let end = pending.indexOf("\n\n");
          while (end >= 0) {
            const frame = pending.slice(0, end);
            pending = pending.slice(end + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (data) onMessage(data);
            end = pending.indexOf("\n\n");
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
