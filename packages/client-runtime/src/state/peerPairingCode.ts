import { type AuthMcpClientAccess, mcpClientScopes } from "@supaterm/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import type { Atom } from "effect/reactivity";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { PreparedConnection } from "../connection/model.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { createEnvironmentCommand } from "./runtime.ts";

const MINT_TIMEOUT_MS = 8_000;
const PEER_PAIRING_CODE_LABEL = "Supaterm link";

export class PeerPairingCodeError extends Data.TaggedError("PeerPairingCodeError")<{
  readonly reason: "not_allowed" | "unavailable";
  readonly cause: unknown;
}> {
  override get message(): string {
    return this.reason === "not_allowed"
      ? "Your session there cannot create pairing codes. Paste a code from there instead."
      : "Could not get a pairing code from there. Paste a code from there instead.";
  }
}

const mintPeerPairingCode = Effect.fn("clientRuntime.state.mintPeerPairingCode")(function* (
  prepared: PreparedConnection,
  access: AuthMcpClientAccess,
): Effect.fn.Return<string, PeerPairingCodeError, HttpClient.HttpClient> {
  const minted = yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    group: "auth",
    url: (urls) => urls.pairingCredential(),
    timeoutMs: MINT_TIMEOUT_MS,
    request: ({ client, headers }) =>
      client.pairingCredential({
        headers,
        payload: { label: PEER_PAIRING_CODE_LABEL, scopes: mcpClientScopes(access) },
      }),
  }).pipe(
    Effect.mapError(
      (cause) =>
        new PeerPairingCodeError({
          reason:
            cause._tag === "EnvironmentScopeRequiredError" ||
            cause._tag === "EnvironmentOperationForbiddenError"
              ? "not_allowed"
              : "unavailable",
          cause,
        }),
    ),
  );
  return minted.credential;
});

export function createPeerPairingCodeCommand<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  return createEnvironmentCommand(runtime, {
    label: "environment-data:peer-pairing-code:mint",
    execute: Effect.fn(function* (access: AuthMcpClientAccess) {
      const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
      const prepared = yield* SubscriptionRef.get(supervisor.prepared);
      if (Option.isNone(prepared)) {
        return yield* new PeerPairingCodeError({
          reason: "unavailable",
          cause: "The environment is not connected.",
        });
      }
      return yield* mintPeerPairingCode(prepared.value, access);
    }),
  });
}
