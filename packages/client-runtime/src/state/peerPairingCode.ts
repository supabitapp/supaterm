/**
 * One-use pairing codes minted on an environment with the user's own session there, so a
 * link can be made without fetching a code by hand. Each carries exactly what an agent
 * sign-in with the chosen access needs.
 */
import { type AuthMcpClientAccess, mcpClientScopes } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { executeConnectedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { createEnvironmentCommand } from "./runtime.ts";

const MINT_TIMEOUT_MS = 8_000;
const PEER_PAIRING_CODE_LABEL = "Supaterm link";

/** Minting failed; the user can still paste a code from the other environment. */
export class PeerPairingCodeError extends Schema.TaggedError<PeerPairingCodeError>()(
  "PeerPairingCodeError",
  {
    reason: Schema.Literals(["not_allowed", "unavailable"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.reason === "not_allowed"
      ? "Your session there cannot create pairing codes. Paste a code from there instead."
      : "Could not get a pairing code from there. Paste a code from there instead.";
  }
}

const mintPairingCredential = Effect.fn("clientRuntime.state.mintPairingCredential")(function* (
  access: AuthMcpClientAccess,
) {
  const minted = yield* executeConnectedEnvironmentHttpRequest({
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

/**
 * Mints a code on the environment it runs in. Each run mints its own: a code
 * is one-use, so two overlapping answers must never share one.
 */
export function createPeerPairingCodeCommand<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  return createEnvironmentCommand(runtime, {
    label: "environment-data:peer-pairing-code:mint",
    execute: (access: AuthMcpClientAccess) => mintPairingCredential(access),
  });
}
