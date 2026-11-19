import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as MobileSecureStorage from "./mobile-secure-storage";

const DEVICE_ID_KEY = "supaterm.agent-awareness.device-id";
const RECENT_THREAD_SHORTCUTS_KEY = "supaterm.recent-thread-shortcuts";

export class MobileStorageDecodeError extends Schema.TaggedError<MobileStorageDecodeError>()(
  "MobileStorageDecodeError",
  {
    key: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to decode mobile storage value for key ${this.key}.`;
  }
}

export class MobileStorageEncodeError extends Schema.TaggedError<MobileStorageEncodeError>()(
  "MobileStorageEncodeError",
  {
    key: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to encode mobile storage value for key ${this.key}.`;
  }
}

export class MobileDeviceIdGenerationError extends Schema.TaggedError<MobileDeviceIdGenerationError>()(
  "MobileDeviceIdGenerationError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to generate the mobile device id.";
  }
}

export interface RecentThreadShortcut {
  readonly environmentId: string;
  readonly threadId: string;
  readonly title: string;
}

export class MobileStorage extends Context.Service<
  MobileStorage,
  {
    readonly loadOrCreateDeviceId: Effect.Effect<
      string,
      MobileSecureStorage.MobileSecureStorageError | MobileDeviceIdGenerationError
    >;
    readonly loadRecentThreadShortcuts: Effect.Effect<
      ReadonlyArray<RecentThreadShortcut>,
      MobileSecureStorage.MobileSecureStorageError
    >;
    readonly saveRecentThreadShortcuts: (
      threads: ReadonlyArray<RecentThreadShortcut>,
    ) => Effect.Effect<
      void,
      MobileSecureStorage.MobileSecureStorageError | MobileStorageEncodeError
    >;
  }
>()("@supaterm/mobile/persistence/MobileStorage") {}

export const make = Effect.fn("MobileStorage.make")(function* () {
  const secureStorage = yield* MobileSecureStorage.MobileSecureStorage;
  const deviceIdLock = yield* Semaphore.make(1);

  const parseJson = <A>(key: string, raw: string): A | null => {
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw) as A;
    } catch (cause) {
      console.warn(
        "[mobile-storage] ignored invalid JSON",
        new MobileStorageDecodeError({ key, cause }),
      );
      return null;
    }
  };

  const readJson = Effect.fn("MobileStorage.readJson")(function* <A>(key: string) {
    const raw = (yield* secureStorage.getItem(key)) ?? "";
    return parseJson<A>(key, raw);
  });

  const writeJson = Effect.fn("MobileStorage.writeJson")(function* (key: string, value: unknown) {
    const encoded = yield* Effect.try({
      try: () => JSON.stringify(value),
      catch: (cause) => new MobileStorageEncodeError({ key, cause }),
    });
    yield* secureStorage.setItem(key, encoded);
  });

  const loadOrCreateDeviceId = Effect.gen(function* () {
    const existing = yield* secureStorage.getItem(DEVICE_ID_KEY);
    if (existing?.trim()) return existing;
    const deviceId = yield* Effect.tryPromise({
      try: () => import("../lib/uuid").then(({ uuidv4 }) => uuidv4()),
      catch: (cause) => new MobileDeviceIdGenerationError({ cause }),
    });
    yield* secureStorage.setItem(DEVICE_ID_KEY, deviceId);
    return deviceId;
  }).pipe(deviceIdLock.withPermits(1));

  const loadRecentThreadShortcuts = readJson<{
    readonly threads?: ReadonlyArray<RecentThreadShortcut>;
  }>(RECENT_THREAD_SHORTCUTS_KEY).pipe(
    Effect.map((parsed) =>
      pipe(
        parsed?.threads ?? [],
        Arr.filter(
          (thread) =>
            typeof thread?.environmentId === "string" &&
            thread.environmentId.length > 0 &&
            typeof thread.threadId === "string" &&
            thread.threadId.length > 0 &&
            typeof thread.title === "string",
        ),
      ),
    ),
  );

  return MobileStorage.of({
    loadOrCreateDeviceId,
    loadRecentThreadShortcuts,
    saveRecentThreadShortcuts: (threads) => writeJson(RECENT_THREAD_SHORTCUTS_KEY, { threads }),
  });
});

export const layer = Layer.effect(MobileStorage, make());
