import type { PushContent, PushEnvelope } from "@supaterm/contracts/push";
import { type PushEnvelopeMetadata, sealPushEnvelope } from "@supaterm/shared/push/envelope";
import {
  type PushGatewayRequest,
  pushHostPublicKey,
  signPushRequest,
} from "@supaterm/shared/push/request";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { signPayload } from "../auth/utils.ts";

export class PushIdentityError extends Schema.TaggedError<PushIdentityError>()(
  "PushIdentityError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not load the host push identity.";
  }
}

export class PushSealError extends Schema.TaggedError<PushSealError>()("PushSealError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "Could not seal the push notification.";
  }
}

export class PushIdentity extends Context.Service<
  PushIdentity,
  {
    /** The host push identity's Ed25519 public key, base64url. */
    readonly publicKey: Effect.Effect<string, PushIdentityError>;
    readonly signRequest: (
      request: PushGatewayRequest,
    ) => Effect.Effect<Record<string, string>, PushIdentityError>;
    readonly seal: (input: {
      readonly recipientPublicKey: string;
      readonly metadata: PushEnvelopeMetadata;
      readonly content: PushContent;
    }) => Effect.Effect<PushEnvelope, PushIdentityError | PushSealError>;
    /** Groups a registration's alerts per thread at APNs without revealing the thread. */
    readonly collapseId: (input: {
      readonly registrationId: string;
      readonly threadId: string;
    }) => Effect.Effect<string, PushIdentityError>;
  }
>()("supaterm/notifications/PushIdentity") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  // Separate from relay-identity so a push key compromise or rotation never touches relay routing.
  const secret = (name: string) =>
    Effect.cached(
      secrets
        .getOrCreateRandom(name, 32)
        .pipe(Effect.mapError((cause) => new PushIdentityError({ cause }))),
    );
  const identity = yield* secret("push-identity");
  const collapseSecret = yield* secret("push-collapse");

  const seal: PushIdentity["Service"]["seal"] = Effect.fn("PushIdentity.seal")(function* (input) {
    const hostSecretKey = yield* identity;
    return yield* Effect.tryPromise({
      try: () => sealPushEnvelope({ ...input, hostSecretKey }),
      catch: (cause) => new PushSealError({ cause }),
    });
  });

  const signRequest: PushIdentity["Service"]["signRequest"] = Effect.fn("PushIdentity.signRequest")(
    function* (request) {
      return signPushRequest(yield* identity, request);
    },
  );

  const collapseId: PushIdentity["Service"]["collapseId"] = Effect.fn("PushIdentity.collapseId")(
    function* ({ registrationId, threadId }) {
      return signPayload(`${registrationId}\n${threadId}`, yield* collapseSecret).slice(0, 32);
    },
  );

  return PushIdentity.of({
    publicKey: Effect.map(identity, pushHostPublicKey),
    signRequest,
    seal,
    collapseId,
  });
});

export const layer = Layer.effect(PushIdentity, make);
