// @effect-diagnostics nodeBuiltinImport:off - the host tunnel owns native WebSocket events.
import * as NodeCrypto from "node:crypto";
import type WebSocket from "ws";
import { acceptClientHandshake } from "@supaterm/shared/relay/protocol";
import {
  createTunnelSession,
  type TunnelSession,
  type TunnelStream,
} from "@supaterm/shared/relay/tunnel";

const MAX_HELLO_BYTES = 4096;

// The accept side of a tunnel, whether the relay's data socket or a direct
// upgrade: one small text hello, then encrypted binary records only.
export function serveHostTunnel(
  ws: WebSocket,
  input: {
    readonly secret: Uint8Array;
    readonly onStream: (stream: TunnelStream) => void;
    readonly onEstablished?: () => void;
    readonly onClose: () => void;
  },
) {
  let session: TunnelSession | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    session?.close();
    ws.terminate();
    input.onClose();
  };
  ws.on("error", close);
  ws.on("close", close);
  ws.on("message", (data, binary) => {
    if (closed) return;
    try {
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : data;
      if (session) {
        if (!binary) throw new Error("Unencrypted tunnel record");
        session.receive(bytes);
        return;
      }
      if (binary || bytes.length > MAX_HELLO_BYTES) throw new Error("Invalid tunnel handshake");
      const accepted = acceptClientHandshake(
        bytes.toString("utf8"),
        input.secret,
        NodeCrypto.randomBytes,
      );
      session = createTunnelSession({
        cipher: accepted.cipher,
        initiator: false,
        onStream: input.onStream,
        send: (message) => ws.send(message),
        onClose: close,
      });
      ws.send(accepted.welcome);
      input.onEstablished?.();
    } catch {
      close();
    }
  });
  return close;
}
