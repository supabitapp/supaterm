import { WsRpcGroup } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import { RpcClient } from "effect/rpc";

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup);
type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;

export const PING_TIMEOUT = "15 seconds";
