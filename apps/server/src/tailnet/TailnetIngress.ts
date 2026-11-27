// @effect-diagnostics nodeBuiltinImport:off - the sidecar hands tailnet connections over a private loopback listener.
import * as NodeCrypto from "node:crypto";
import type * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import { after } from "@supaterm/shared/relay/timer";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { IngressPreamble } from "./protocol.ts";
import { markTailnetSocket, type TailnetPeer, tailnetPeerOfSocket } from "./tailnetPeer.ts";

const MAX_PREAMBLE_BYTES = 4096;
const PREAMBLE_TIMEOUT_MS = 5_000;

class TailnetIngressError extends Schema.TaggedError<TailnetIngressError>()("TailnetIngressError", {
  cause: Schema.Defect(),
}) {}

interface TailnetIngressEndpoint {
  readonly address: string;
  readonly secret: string;
  readonly disconnect: (refused: (peer: TailnetPeer) => boolean) => void;
}

export class TailnetIngress extends Context.Service<
  TailnetIngress,
  {
    readonly open: Effect.Effect<TailnetIngressEndpoint, TailnetIngressError, Scope.Scope>;
  }
>()("supaterm/tailnet/TailnetIngress") {}

const decodePreamble = Schema.decodeUnknownOption(Schema.fromJsonString(IngressPreamble));

function secretMatches(expected: Buffer, received: string): boolean {
  const candidate = Buffer.from(received, "utf8");
  return candidate.length === expected.length && NodeCrypto.timingSafeEqual(candidate, expected);
}

function acceptTailnetConnection(input: {
  readonly socket: NodeNet.Socket;
  readonly secret: Buffer;
  readonly deliver: (socket: NodeNet.Socket) => void;
}): void {
  const { socket } = input;
  let buffered: Buffer = Buffer.alloc(0);
  const reject = () => {
    cleanup();
    socket.destroy();
  };
  const cancelTimer = after(PREAMBLE_TIMEOUT_MS, reject);
  const onData = (chunk: Buffer) => {
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
    const newline = buffered.indexOf(0x0a);
    if (newline === -1) {
      if (buffered.length > MAX_PREAMBLE_BYTES) reject();
      return;
    }
    if (newline > MAX_PREAMBLE_BYTES) return reject();
    const preamble = decodePreamble(buffered.subarray(0, newline).toString("utf8"));
    if (Option.isNone(preamble) || !secretMatches(input.secret, preamble.value.secret)) {
      return reject();
    }
    cleanup();
    const rest = buffered.subarray(newline + 1);
    // The HTTP server reads unshifted bytes only while the socket keeps flowing, so it is never paused here.
    if (rest.length > 0) socket.unshift(rest);
    markTailnetSocket(socket, {
      tls: preamble.value.tls,
      remoteAddress: preamble.value.remoteAddress,
      remotePort: preamble.value.remotePort,
      identity: preamble.value.identity,
    });
    input.deliver(socket);
  };
  const cleanup = () => {
    cancelTimer();
    socket.off("data", onData);
    socket.off("error", reject);
  };
  socket.on("data", onData);
  socket.on("error", reject);
}

export const openIngress = (server: NodeHttp.Server) =>
  Effect.acquireRelease(
    Effect.callback<
      {
        readonly listener: NodeNet.Server;
        readonly sockets: Set<NodeNet.Socket>;
        readonly address: string;
        readonly secret: string;
      },
      TailnetIngressError
    >((resume) => {
      const secret = NodeCrypto.randomBytes(32).toString("base64url");
      const expected = Buffer.from(secret, "utf8");
      const sockets = new Set<NodeNet.Socket>();
      const listener = NodeNet.createServer((socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        acceptTailnetConnection({
          socket,
          secret: expected,
          deliver: (accepted) => server.emit("connection", accepted),
        });
      });
      listener.once("error", (cause) => resume(Effect.fail(new TailnetIngressError({ cause }))));
      listener.listen(0, "127.0.0.1", () => {
        const address = listener.address() as NodeNet.AddressInfo;
        resume(Effect.succeed({ listener, sockets, secret, address: `127.0.0.1:${address.port}` }));
      });
    }),
    ({ listener, sockets }) =>
      Effect.sync(() => {
        listener.close();
        for (const socket of sockets) socket.destroy();
      }),
  ).pipe(
    Effect.map(({ address, secret, sockets }) => ({
      address,
      secret,
      disconnect: (refused: (peer: TailnetPeer) => boolean) => {
        for (const socket of sockets) {
          const peer = tailnetPeerOfSocket(socket);
          if (peer !== undefined && refused(peer)) socket.destroy();
        }
      },
    })),
  );

export const layerFromServer = (server: NodeHttp.Server) =>
  Layer.succeed(TailnetIngress, TailnetIngress.of({ open: openIngress(server) }));
