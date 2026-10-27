import {
  RELAY_COMPANION_META_NAME,
  RELAY_COMPANION_REQUEST_LIMIT,
  canonicalRelayAddress,
} from "@supaterm/shared/relay/protocol";
import { RelayCompanionReply } from "@supaterm/contracts";
import { after } from "@supaterm/shared/relay/timer";
import * as Schema from "effect/Schema";

const decodeReply = Schema.decodeUnknownSync(Schema.fromJsonString(RelayCompanionReply));

export function isRelayCompanion(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(`meta[name="${RELAY_COMPANION_META_NAME}"]`)?.getAttribute("content") ===
      "1"
  );
}

interface Pending {
  readonly action: "open" | "close";
  readonly address: string;
  settle?: ((error: Error | undefined, origin?: string) => void) | undefined;
}

export function createRelayCompanionControl() {
  let socket: WebSocket | undefined;
  let connected: Promise<WebSocket> | undefined;
  let disposed = false;
  const origins = new Map<string, string>();
  const candidates = new Map<string, string>();
  const pending = new Map<string, Pending>();
  let sequence = 0;

  const connect = () => {
    if (connected) return connected;
    const url = new URL("/__relay/control", location.href);
    url.protocol = "ws:";
    const current = new WebSocket(url);
    socket = current;
    connected = new Promise<WebSocket>((resolve, reject) => {
      const fail = () => {
        cancel();
        const error = new Error("The local relay companion disconnected.");
        reject(error);
        if (socket !== current) return;
        socket = undefined;
        connected = undefined;
        origins.clear();
        candidates.clear();
        for (const request of pending.values())
          request.settle?.(request.action === "close" ? undefined : error);
        pending.clear();
      };
      const cancel = after(15_000, () => {
        current.close();
        fail();
      });
      current.addEventListener(
        "open",
        () => {
          cancel();
          resolve(current);
        },
        { once: true },
      );
      current.addEventListener("close", fail);
      current.addEventListener("error", fail);
      current.addEventListener("message", (event) => {
        if (socket !== current) return;
        try {
          const reply = decodeReply(String(event.data));
          const request = pending.get(reply.id);
          if (!request) return;
          pending.delete(reply.id);
          if (reply.error) return request.settle?.(new Error(reply.error));
          if (request.action === "close") {
            origins.delete(request.address);
            candidates.delete(request.address);
          } else if (reply.origin) origins.set(request.address, reply.origin);
          request.settle?.(undefined, reply.origin);
        } catch {
          current.close();
        }
      });
    });
    return connected;
  };

  return {
    async request(
      action: "open" | "close",
      input: string,
      relayUrl?: string,
      directUrls?: ReadonlyArray<string>,
    ) {
      if (disposed) throw new Error("The local relay companion is closed.");
      const address = canonicalRelayAddress(input);
      if (!address) throw new Error("Not a relay address");
      const queued = [...pending.values()].some((request) => request.address === address);
      const direct = JSON.stringify(directUrls ?? []);
      if (
        action === "open" &&
        !queued &&
        origins.has(address) &&
        (directUrls === undefined || candidates.get(address) === direct)
      )
        return origins.get(address);
      if (action === "close" && !queued && !origins.has(address)) return undefined;
      const limit = RELAY_COMPANION_REQUEST_LIMIT * (action === "close" ? 2 : 1);
      if (pending.size >= limit) throw new Error("Too many companion requests.");
      const id = String(++sequence);
      const request: Pending = { action, address };
      pending.set(id, request);
      const current = connect();
      return new Promise<string | undefined>((resolve, reject) => {
        const cancel = after(15_000, () => {
          request.settle = undefined;
          reject(new Error("The relay companion did not respond."));
        });
        request.settle = (error, origin) => {
          cancel();
          request.settle = undefined;
          if (error) reject(error);
          else if (action === "open" && !origin)
            reject(new Error("The companion did not return a relay origin."));
          else resolve(origin);
        };
        current.then(
          (opened) => {
            if (pending.get(id) !== request) return;
            if (action === "open" && directUrls !== undefined) candidates.set(address, direct);
            opened.send(JSON.stringify({ id, action, address, relayUrl, directUrls }));
          },
          () => {},
        );
      });
    },
    close() {
      disposed = true;
      for (const request of pending.values())
        request.settle?.(new Error("The local relay companion is closed."));
      pending.clear();
      socket?.close();
    },
  };
}
