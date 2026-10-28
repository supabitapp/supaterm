// @effect-diagnostics nodeBuiltinImport:off - drives the host tunnel over a real WebSocket pair.
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import { expect, it } from "vite-plus/test";
import WebSocket, { WebSocketServer } from "ws";
import { createClientHandshake, relayPublicKey } from "@supaterm/shared/relay/protocol";
import { serveHostTunnel } from "./hostTunnel.ts";

it("tears down an established tunnel on a record it cannot open and reports the close once", async () => {
  const secret = NodeCrypto.randomBytes(32);
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await NodeEvents.EventEmitter.once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No TCP listener");
  const established = Promise.withResolvers<void>();
  const hostClosed = Promise.withResolvers<void>();
  let closes = 0;
  server.once("connection", (ws) => {
    ws.once("close", () => hostClosed.resolve());
    serveHostTunnel(ws, {
      secret,
      onStream: () => {},
      onEstablished: () => established.resolve(),
      onClose: () => closes++,
    });
  });
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  try {
    await NodeEvents.EventEmitter.once(client, "open");
    const handshake = createClientHandshake(relayPublicKey(secret), NodeCrypto.randomBytes);
    const welcome = NodeEvents.EventEmitter.once(client, "message");
    client.send(handshake.hello);
    handshake.finish(String((await welcome)[0]));
    await established.promise;

    const clientClosed = NodeEvents.EventEmitter.once(client, "close");
    client.send("plaintext");
    await Promise.all([hostClosed.promise, clientClosed]);
    expect(closes).toBe(1);
  } finally {
    client.terminate();
    server.close();
  }
});
