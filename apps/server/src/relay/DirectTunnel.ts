// @effect-diagnostics nodeBuiltinImport:off - the direct tunnel owns its native WebSocket upgrade.
import * as NodeCrypto from "node:crypto";
import type * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import WebSocket, { WebSocketServer } from "ws";
import { MAX_DIRECT_TUNNEL_URLS, type ServerTunnelEndpoints } from "@supaterm/contracts";
import { acceptClientHandshake } from "@supaterm/shared/relay/protocol";
import {
  createTunnelSession,
  TUNNEL_MAX_PLAIN_BYTES,
  type TunnelSession,
  type TunnelStream,
} from "@supaterm/shared/relay/tunnel";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ServerConfig from "../config.ts";
import { resolveBoundEndpoints } from "../environment/DirectEndpoints.ts";
import * as RelayIdentity from "./RelayIdentity.ts";
import { RelayIngress } from "./RelayIngress.ts";

const HANDSHAKE_TIMEOUT = Duration.seconds(15);
const MAX_HELLO_BYTES = 4096;
const EMPTY_HEAD = Buffer.alloc(0);

export class DirectTunnelNotFoundError extends Schema.TaggedError<DirectTunnelNotFoundError>()(
  "DirectTunnelNotFoundError",
  { reason: Schema.Literals(["not-websocket", "no-identity", "endpoint-mismatch"]) },
) {
  override get message(): string {
    return "No direct tunnel endpoint matches this request.";
  }
}

export class DirectTunnelBusyError extends Schema.TaggedError<DirectTunnelBusyError>()(
  "DirectTunnelBusyError",
  { limit: Schema.Literals(["pending-handshakes", "sessions", "peer-sessions"]) },
) {
  override get message(): string {
    return "Too many direct tunnel connections.";
  }
}

export class DirectTunnelIdentityError extends Schema.TaggedError<DirectTunnelIdentityError>()(
  "DirectTunnelIdentityError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to read the relay identity.";
  }
}

export interface DirectTunnelLimits {
  readonly pendingHandshakes: number;
  readonly sessions: number;
  readonly sessionsPerPeer: number;
}

export class DirectTunnel extends Context.Service<
  DirectTunnel,
  {
    readonly accept: (input: {
      readonly endpointId: string | null;
      readonly request: NodeHttp.IncomingMessage;
    }) => Effect.Effect<
      void,
      DirectTunnelNotFoundError | DirectTunnelBusyError | DirectTunnelIdentityError
    >;
    readonly advertisement: Effect.Effect<Option.Option<ServerTunnelEndpoints>>;
    readonly advertisements: Stream.Stream<Option.Option<ServerTunnelEndpoints>>;
  }
>()("supaterm/relay/DirectTunnel") {}

// Node only emits `upgrade` for `Connection: upgrade`; anything else is a plain
// request whose socket the HTTP parser still owns.
const isWebSocketUpgrade = (request: NodeHttp.IncomingMessage) =>
  request.headers.upgrade?.toLowerCase() === "websocket" &&
  (request.headers.connection ?? "")
    .toLowerCase()
    .split(",")
    .some((token) => token.trim() === "upgrade");

const peerKey = (address: string | undefined) =>
  address?.startsWith("::ffff:") ? address.slice("::ffff:".length) : (address ?? "");

// The accept side of the relay's data socket (see transport.ts): one small
// text hello, then encrypted binary records only.
function serveTunnel(
  ws: WebSocket,
  input: {
    readonly secret: Uint8Array;
    readonly onStream: (stream: TunnelStream) => void;
    readonly onEstablished: () => void;
    readonly onClose: () => void;
  },
) {
  let session: TunnelSession | undefined;
  const stop = () => {
    session?.close();
    ws.terminate();
  };
  ws.once("close", () => {
    session?.close();
    input.onClose();
  });
  ws.on("error", stop);
  ws.on("message", (data, binary) => {
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
      if (binary || bytes.length > MAX_HELLO_BYTES) throw new Error("Invalid handshake");
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
        onClose: stop,
      });
      ws.send(accepted.welcome);
      input.onEstablished();
    } catch {
      stop();
    }
  });
}

const make = Effect.fn("DirectTunnel.make")(function* (limits: DirectTunnelLimits) {
  const config = yield* ServerConfig.ServerConfig;
  const identity = yield* RelayIdentity.RelayIdentity;
  const ingress = yield* RelayIngress;
  // The host's shared WebSocket server negotiates permessage-deflate and
  // accepts 100 MiB frames. Ciphertext does not compress, and an anonymous
  // peer must not make the host buffer more than one tunnel record.
  const upgrades = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new WebSocketServer({
          noServer: true,
          clientTracking: false,
          perMessageDeflate: false,
          maxPayload: TUNNEL_MAX_PLAIN_BYTES + 24,
        }),
    ),
    (server) => Effect.sync(() => server.close()),
  );

  let pendingHandshakes = 0;
  let sessions = 0;
  const peers = new Map<string, number>();

  const exceededLimit = (peerSessions: number) => {
    if (pendingHandshakes >= limits.pendingHandshakes) return "pending-handshakes";
    if (sessions >= limits.sessions) return "sessions";
    if (peerSessions >= limits.sessionsPerPeer) return "peer-sessions";
    return undefined;
  };

  const admit = (peer: string) =>
    Effect.acquireRelease(
      Effect.suspend(() => {
        const peerSessions = peers.get(peer) ?? 0;
        const limit = exceededLimit(peerSessions);
        if (limit !== undefined) return Effect.fail(new DirectTunnelBusyError({ limit }));
        pendingHandshakes++;
        sessions++;
        peers.set(peer, peerSessions + 1);
        let pending = true;
        return Effect.succeed({
          settle: () => {
            if (!pending) return;
            pending = false;
            pendingHandshakes--;
          },
        });
      }),
      (slot) =>
        Effect.sync(() => {
          slot.settle();
          sessions--;
          const remaining = (peers.get(peer) ?? 1) - 1;
          if (remaining === 0) peers.delete(peer);
          else peers.set(peer, remaining);
        }),
    );

  // ws answers a malformed upgrade itself and never calls back, so the
  // socket closing is the only signal that it refused. `serve` runs inside the
  // callback so no message can arrive before its listeners do.
  const upgrade = (request: NodeHttp.IncomingMessage, serve: (ws: WebSocket) => void) =>
    Effect.acquireRelease(
      Effect.callback<Option.Option<WebSocket>>((resume) => {
        const socket = request.socket;
        const refused = () => resume(Effect.succeedNone);
        if (socket.destroyed) return refused();
        socket.once("close", refused);
        upgrades.handleUpgrade(request, socket, EMPTY_HEAD, (ws) => {
          socket.off("close", refused);
          serve(ws);
          resume(Effect.succeedSome(ws));
        });
        return Effect.sync(() => {
          socket.off("close", refused);
          socket.destroy();
        });
      }),
      // Effect writes the route's response unless the socket is already
      // destroyed, so the tunnel must be torn down before the route returns.
      (ws) =>
        Effect.sync(() => {
          if (Option.isSome(ws)) ws.value.terminate();
        }),
    );

  const run = Effect.fnUntraced(function* (input: {
    readonly request: NodeHttp.IncomingMessage;
    readonly secret: Uint8Array;
    readonly peer: string;
    readonly settle: () => void;
  }) {
    const established = yield* Deferred.make<boolean>();
    const closed = yield* Deferred.make<void>();
    const ok = yield* upgrade(input.request, (ws) =>
      serveTunnel(ws, {
        secret: input.secret,
        onStream: (stream) =>
          ingress.accept(stream, { transport: "direct", remoteAddress: input.peer }),
        onEstablished: () => Deferred.doneUnsafe(established, Exit.succeed(true)),
        onClose: () => {
          Deferred.doneUnsafe(established, Exit.succeed(false));
          Deferred.doneUnsafe(closed, Exit.void);
        },
      }),
    ).pipe(
      Effect.flatMap((ws) =>
        Option.isSome(ws) ? Deferred.await(established) : Effect.succeed(false),
      ),
      Effect.timeoutOrElse({ duration: HANDSHAKE_TIMEOUT, orElse: () => Effect.succeed(false) }),
    );
    input.settle();
    if (ok) yield* Deferred.await(closed);
  }, Effect.scoped);

  const accept = Effect.fn("DirectTunnel.accept")(function* (input: {
    readonly endpointId: string | null;
    readonly request: NodeHttp.IncomingMessage;
  }) {
    if (!isWebSocketUpgrade(input.request))
      return yield* new DirectTunnelNotFoundError({ reason: "not-websocket" });
    // Read, never create: an identity makes RelayAccess register with the public
    // relay on the next start, and only relay-paired clients can pin one anyway.
    const current = yield* identity.existing.pipe(
      Effect.mapError((cause) => new DirectTunnelIdentityError({ cause })),
    );
    if (Option.isNone(current))
      return yield* new DirectTunnelNotFoundError({ reason: "no-identity" });
    if (input.endpointId !== current.value.endpointId)
      return yield* new DirectTunnelNotFoundError({ reason: "endpoint-mismatch" });
    const peer = peerKey(input.request.socket.remoteAddress);
    const slot = yield* admit(peer);
    yield* run({ request: input.request, secret: current.value.secret, peer, ...slot });
  }, Effect.scoped);

  const endpointsFor = (
    found: Option.Option<{ readonly address: string }>,
  ): Option.Option<ServerTunnelEndpoints> =>
    Option.flatMap(found, ({ address }) => {
      const urls = resolveBoundEndpoints({
        host: config.host,
        port: config.port,
        interfaces: NodeOS.networkInterfaces(),
      })
        .map((endpoint) => `ws://${new URL(endpoint.httpBaseUrl).host}`)
        .slice(0, MAX_DIRECT_TUNNEL_URLS);
      return urls.length === 0 ? Option.none() : Option.some({ address, urls });
    });

  return DirectTunnel.of({
    accept,
    advertisement: identity.existing.pipe(
      Effect.map(endpointsFor),
      Effect.catch((error) =>
        Effect.logWarning("Direct tunnel endpoints are unavailable", { error }).pipe(
          Effect.as(Option.none()),
        ),
      ),
    ),
    advertisements: identity.changes.pipe(
      Stream.map(endpointsFor),
      Stream.catch(() => Stream.empty),
    ),
  });
});

const DEFAULT_LIMITS: DirectTunnelLimits = {
  pendingHandshakes: 16,
  sessions: 64,
  sessionsPerPeer: 8,
};

export const layerWithLimits = (limits: DirectTunnelLimits) =>
  Layer.effect(DirectTunnel, make(limits));

export const layer = layerWithLimits(DEFAULT_LIMITS);
