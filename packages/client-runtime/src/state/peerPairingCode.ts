/**
 * A one-use pairing code minted on an environment with the user's own session there, so a
 * link can be made without fetching a code by hand. It carries exactly what an agent
 * sign-in with the chosen access needs.
 */
import {
  type AuthCreatePairingCredentialInput,
  type AuthMcpClientAccess,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import type { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
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

const mintOnEnvironment = Effect.fn("clientRuntime.state.mintPeerPairingCode")(function* (
  payload: AuthCreatePairingCredentialInput,
) {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  if (Option.isNone(prepared)) {
    return yield* new PeerPairingCodeError({
      reason: "unavailable",
      cause: "The environment is not connected.",
    });
  }
  if (prepared.value.descriptor?.capabilities.peerLinkPairingCodes !== true) {
    return yield* new PeerPairingCodeError({
      reason: "unavailable",
      cause: "The environment does not support peer-link pairing codes.",
    });
  }
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared: prepared.value,
    group: "auth",
    url: (urls) => urls.pairingCredential(),
    timeoutMs: MINT_TIMEOUT_MS,
    request: ({ client, headers }) => client.pairingCredential({ headers, payload }),
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
    execute: (access: AuthMcpClientAccess) =>
      mintOnEnvironment({ label: PEER_PAIRING_CODE_LABEL, access, purpose: "peer-link" }).pipe(
        Effect.filterOrFail(
          (minted) => minted.purpose === "peer-link" && minted.access === access,
          () =>
            new PeerPairingCodeError({
              reason: "unavailable",
              cause: "The environment did not issue a peer-link code.",
            }),
        ),
        Effect.map((minted) => minted.credential),
      ),
  });
}
