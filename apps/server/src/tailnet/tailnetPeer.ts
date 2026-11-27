// @effect-diagnostics nodeBuiltinImport:off - marks the Node sockets that the tailnet ingress hands to the HTTP server.
import * as NodeNet from "node:net";
import type { HttpServerRequest } from "effect/http";
import type { TailnetCallerIdentity } from "./protocol.ts";

export interface TailnetPeer {
  readonly tls: boolean;
  readonly remoteAddress: string;
  readonly identity: TailnetCallerIdentity | null;
}

const peerKey = Symbol("supaterm.tailnetPeer");

export function markTailnetSocket(
  socket: NodeNet.Socket,
  peer: TailnetPeer & { readonly remotePort: number },
): void {
  Object.defineProperty(socket, peerKey, {
    value: { tls: peer.tls, remoteAddress: peer.remoteAddress, identity: peer.identity },
  });
  Object.defineProperty(socket, "remoteAddress", { value: peer.remoteAddress });
  Object.defineProperty(socket, "remoteFamily", {
    value: NodeNet.isIPv6(peer.remoteAddress) ? "IPv6" : "IPv4",
  });
  Object.defineProperty(socket, "remotePort", { value: peer.remotePort });
}

export function tailnetPeerOfSocket(socket: unknown): TailnetPeer | undefined {
  if (!(socket instanceof NodeNet.Socket) || !Object.hasOwn(socket, peerKey)) return undefined;
  return (socket as unknown as Record<typeof peerKey, TailnetPeer>)[peerKey];
}

export function tailnetPeerOfRequest(
  request: HttpServerRequest.HttpServerRequest,
): TailnetPeer | undefined {
  const source = request.source;
  return source instanceof Object && "socket" in source
    ? tailnetPeerOfSocket(source.socket)
    : undefined;
}
