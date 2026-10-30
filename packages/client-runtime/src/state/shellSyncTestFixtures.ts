import { EnvironmentId, type OrchestrationV2ShellSnapshot } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import type * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import { v2ShellSnapshot } from "./orchestrationV2TestFixtures.ts";

export const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

export const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: TARGET.wsBaseUrl,
  httpAuthorization: null,
  target: TARGET,
};

export const LIVE_SHELL_SNAPSHOT: OrchestrationV2ShellSnapshot = {
  ...v2ShellSnapshot,
  snapshotSequence: 1,
};

export function session(client: WsRpcProtocolClient): RpcSession.RpcSession {
  return {
    client,
    initialConfig: Effect.succeed({ shellResumeCompletionMarker: true } as never),
    configChanges: Stream.empty,
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}
