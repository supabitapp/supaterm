import { relayEndpointId, relayHttpBaseUrl, relayPublicKey } from "@supaterm/shared/relay/protocol";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

type Identity = {
  readonly secret: Uint8Array;
  readonly address: string;
  readonly endpointId: string;
};

export class RelayIdentity extends Context.Service<
  RelayIdentity,
  {
    readonly get: Effect.Effect<Identity, ServerSecretStore.SecretStoreError>;
    readonly existing: Effect.Effect<Option.Option<Identity>, ServerSecretStore.SecretStoreError>;
    readonly changes: Stream.Stream<Option.Option<Identity>, ServerSecretStore.SecretStoreError>;
  }
>()("supaterm/relay/RelayIdentity") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  // Nothing deletes the identity while the server runs, so once one is known it
  // is the answer for the rest of the process.
  const known = yield* SubscriptionRef.make(Option.none<Identity>());
  const fromSecret = (secret: Uint8Array): Identity => {
    const publicKey = relayPublicKey(secret);
    return { secret, address: relayHttpBaseUrl(publicKey), endpointId: relayEndpointId(publicKey) };
  };
  const remember = (identity: Identity) =>
    SubscriptionRef.set(known, Option.some(identity)).pipe(Effect.as(identity));
  const get = yield* Effect.cached(
    secrets
      .getOrCreateRandom("relay-identity", 32)
      .pipe(Effect.map(fromSecret), Effect.flatMap(remember)),
  );
  const load = secrets.get("relay-identity").pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeedNone,
        onSome: (secret) => Effect.asSome(remember(fromSecret(secret))),
      }),
    ),
  );
  const existing = Effect.filterOrElse(SubscriptionRef.get(known), Option.isSome, () => load);
  const changes = Stream.unwrap(existing.pipe(Effect.as(SubscriptionRef.changes(known))));
  return RelayIdentity.of({ get, existing, changes });
});

export const layer = Layer.effect(RelayIdentity, make);
