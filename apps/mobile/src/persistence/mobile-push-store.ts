import { EnvironmentId } from "@supaterm/contracts";
import {
  DEFAULT_PUSH_KINDS,
  PushGatewayOrigin,
  PushHandle,
  PushId,
  PushKey32,
  PushKinds,
  PushPreviewLevel,
} from "@supaterm/contracts/push";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as MobileSecureStorage from "./mobile-secure-storage";

export const MobilePushRegistration = Schema.Struct({
  environmentId: EnvironmentId,
  registrationId: PushId,
  keyId: PushId,
  publicKey: PushKey32,
  hostKey: PushKey32,
  handle: PushHandle,
  gatewayOrigin: PushGatewayOrigin,
  installationId: Schema.String,
  preview: PushPreviewLevel,
  kinds: PushKinds,
});
export type MobilePushRegistration = typeof MobilePushRegistration.Type;

/** A handle whose gateway deletion failed; retried on later syncs so a removed host stops alerting. */
export const MobilePushRetiredHandle = Schema.Struct({
  installationId: Schema.String,
  handle: PushHandle,
});
export type MobilePushRetiredHandle = typeof MobilePushRetiredHandle.Type;

export const MobilePushSettings = Schema.Struct({
  enabled: Schema.Boolean,
  preview: PushPreviewLevel,
  kinds: PushKinds,
  registrations: Schema.Array(MobilePushRegistration),
  retiredHandles: Schema.Array(MobilePushRetiredHandle),
  /** Environments whose owner removed this device; they stay off until the user turns them on again. */
  revokedEnvironments: Schema.Array(EnvironmentId).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});
export type MobilePushSettings = typeof MobilePushSettings.Type;

export const DEFAULT_MOBILE_PUSH_SETTINGS: MobilePushSettings = {
  enabled: false,
  preview: "titles",
  kinds: DEFAULT_PUSH_KINDS,
  registrations: [],
  retiredHandles: [],
  revokedEnvironments: [],
};

const SETTINGS_KEY = "supaterm.push.settings";
const settingsCodec = Schema.fromJsonString(MobilePushSettings);

export class MobilePushStoreError extends Schema.TaggedError<MobilePushStoreError>()(
  "MobilePushStoreError",
  {
    operation: Schema.Literals(["read", "write"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Could not save notification settings on this device.";
  }
}

export class MobilePushStore extends Context.Service<
  MobilePushStore,
  {
    readonly load: Effect.Effect<MobilePushSettings, MobilePushStoreError>;
    readonly save: (settings: MobilePushSettings) => Effect.Effect<void, MobilePushStoreError>;
  }
>()("@supaterm/mobile/persistence/MobilePushStore") {}

export const make = Effect.gen(function* () {
  const storage = yield* MobileSecureStorage.MobileSecureStorage;
  const load = Effect.gen(function* () {
    const value = yield* storage.getItem(SETTINGS_KEY);
    if (value === null) return DEFAULT_MOBILE_PUSH_SETTINGS;
    // A value this build cannot read is treated as never configured; the next sync rebuilds it.
    return yield* Schema.decodeEffect(settingsCodec)(value).pipe(
      Effect.orElseSucceed(() => DEFAULT_MOBILE_PUSH_SETTINGS),
    );
  }).pipe(
    Effect.mapError((cause) => new MobilePushStoreError({ operation: "read", cause })),
    Effect.withSpan("MobilePushStore.load"),
  );
  const save = Effect.fn("MobilePushStore.save")(
    function* (settings: MobilePushSettings) {
      const value = yield* Schema.encodeEffect(settingsCodec)(settings);
      yield* storage.setItem(SETTINGS_KEY, value);
    },
    Effect.mapError((cause) => new MobilePushStoreError({ operation: "write", cause })),
  );
  return MobilePushStore.of({ load, save });
});

export const layer = Layer.effect(MobilePushStore, make);
