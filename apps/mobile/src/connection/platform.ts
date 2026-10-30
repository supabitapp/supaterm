import { MobileStorage } from "../persistence/mobile-storage";
import {
  ClientCapabilities,
  PlatformConnectionSource,
  Persistence,
} from "@supaterm/client-runtime/platform";
import { ConnectionBlockedError, Connectivity, Wakeups } from "@supaterm/client-runtime/connection";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import Constants from "expo-constants";
import * as Network from "expo-network";
import { AppState } from "react-native";

import { authClientMetadata } from "../lib/authClientMetadata";
import * as Runtime from "../lib/runtime";
import { clearThreadOutboxEnvironment } from "../state/thread-outbox-removal";
import { clearComposerDraftsEnvironment } from "../state/use-composer-drafts";
import { clearThreadComposerErrorsForEnvironment } from "../state/thread-composer-error";
import { mobileApplicationStateWakeup } from "./app-state-wakeups";
import * as ConnectionStorage from "./storage";

function networkStatus(state: Network.NetworkState): "unknown" | "offline" | "online" {
  if (state.isConnected === false) {
    return "offline";
  }
  if (state.isConnected === true) {
    return "online";
  }
  return "unknown";
}

const layerConnectivity = Connectivity.layer({
  status: Effect.tryPromise({
    try: () => Network.getNetworkStateAsync(),
    catch: () => undefined,
  }).pipe(
    Effect.match({
      onFailure: () => "unknown" as const,
      onSuccess: networkStatus,
    }),
  ),
  changes: Stream.callback((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let active = true;
        const networkSubscription = Network.addNetworkStateListener((state) => {
          Queue.offerUnsafe(queue, networkStatus(state));
        });
        const appStateSubscription = AppState.addEventListener("change", (state) => {
          if (state !== "active") {
            return;
          }
          void Network.getNetworkStateAsync()
            .then((current) => {
              if (active) {
                Queue.offerUnsafe(queue, networkStatus(current));
              }
            })
            .catch(() => undefined);
        });
        return {
          close: () => {
            active = false;
            networkSubscription.remove();
            appStateSubscription.remove();
          },
        };
      }),
      ({ close }) => Effect.sync(close),
    ).pipe(Effect.asVoid),
  ),
});

/**
 * Wakes connections when the device moves between networks while staying
 * online, such as Wi-Fi to cellular. Connectivity only reports online or
 * offline, so leaving home on cellular would otherwise go unnoticed until the
 * LAN socket times out.
 */
const networkPathChanges = Stream.callback<"network-changed">((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      let active = true;
      let previous: Network.NetworkStateType | undefined;
      const record = (state: Network.NetworkState) => {
        const type = state.isConnected === true ? state.type : undefined;
        if (previous !== undefined && type !== undefined && type !== previous) {
          Queue.offerUnsafe(queue, "network-changed");
        }
        previous = type ?? previous;
      };
      // The listener reports changes only, so seed the current type; without
      // it the first Wi-Fi to cellular move would go unnoticed.
      void Network.getNetworkStateAsync()
        .then((state) => {
          if (active && previous === undefined && state.isConnected === true) {
            previous = state.type;
          }
        })
        .catch(() => undefined);
      const subscription = Network.addNetworkStateListener(record);
      return {
        remove: () => {
          active = false;
          subscription.remove();
        },
      };
    }),
    (subscription) => Effect.sync(() => subscription.remove()),
  ).pipe(Effect.asVoid),
);

const layerWakeups = Wakeups.layer({
  isBackgrounded: Effect.sync(() => AppState.currentState === "background"),
  changes: Stream.mergeAll(
    [
      Stream.callback<Wakeups.ConnectionWakeup>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            let previous = AppState.currentState;
            return AppState.addEventListener("change", (state) => {
              const reason = mobileApplicationStateWakeup(previous, state);
              previous = state;
              if (reason !== null) Queue.offerUnsafe(queue, reason);
            });
          }),
          (subscription) => Effect.sync(() => subscription.remove()),
        ).pipe(Effect.asVoid),
      ),
      networkPathChanges,
    ],
    { concurrency: "unbounded" },
  ),
});

const layerCapabilities = Layer.succeedContext(
  Context.make(
    ClientCapabilities.PrimaryEnvironmentAuth,
    ClientCapabilities.PrimaryEnvironmentAuth.of({ bearerToken: Effect.succeed(Option.none()) }),
  ).pipe(
    Context.add(ClientCapabilities.AnalyticsDevice, {
      id: Effect.flatMap(MobileStorage, (storage) => storage.loadOrCreateDeviceId).pipe(
        Effect.provide(Runtime.layer),
        Effect.option,
      ),
    }),
    Context.add(
      ClientCapabilities.ClientPresentation,
      ClientCapabilities.ClientPresentation.of({
        metadata: authClientMetadata(Constants.expoConfig?.version),
      }),
    ),
    Context.add(
      ClientCapabilities.SshEnvironmentGateway,
      ClientCapabilities.SshEnvironmentGateway.of({
        provision: () =>
          Effect.fail(
            new ConnectionBlockedError({
              reason: "unsupported",
              detail: "SSH environments are only available in the desktop app.",
            }),
          ),
        prepare: () =>
          Effect.fail(
            new ConnectionBlockedError({
              reason: "unsupported",
              detail: "SSH environments are only available in the desktop app.",
            }),
          ),
        disconnect: () => Effect.void,
      }),
    ),
  ),
);

const layerPlatformConnectionSource = Layer.succeed(
  PlatformConnectionSource.PlatformConnectionSource,
  PlatformConnectionSource.PlatformConnectionSource.of({
    registrations: Stream.empty,
  }),
);

const layerProvidedConnectionStorage = ConnectionStorage.layer.pipe(Layer.provide(Runtime.layer));

const layerEnvironmentOwnedDataCleanup = Layer.succeed(
  Persistence.EnvironmentOwnedDataCleanup,
  Persistence.EnvironmentOwnedDataCleanup.of({
    clear: (environmentId) =>
      Effect.all(
        [
          Effect.promise(() => clearThreadOutboxEnvironment(environmentId)),
          Effect.promise(() => clearComposerDraftsEnvironment(environmentId)),
          Effect.sync(() => clearThreadComposerErrorsForEnvironment(environmentId)),
        ],
        { concurrency: "unbounded", discard: true },
      ).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not clear mobile environment-owned data.", {
            environmentId,
            cause,
          }),
        ),
      ),
  }),
);

type ConnectionPlatformLayerSource =
  | typeof layerProvidedConnectionStorage
  | typeof Runtime.layer
  | typeof layerConnectivity
  | typeof layerWakeups
  | typeof layerCapabilities
  | typeof layerPlatformConnectionSource
  | typeof layerEnvironmentOwnedDataCleanup;

export const layer: Layer.Layer<
  Layer.Success<ConnectionPlatformLayerSource>,
  Layer.Error<ConnectionPlatformLayerSource>,
  Layer.Services<ConnectionPlatformLayerSource>
> = Layer.mergeAll(
  layerProvidedConnectionStorage,
  Runtime.layer,
  layerConnectivity,
  layerWakeups,
  layerCapabilities,
  layerPlatformConnectionSource,
  layerEnvironmentOwnedDataCleanup,
);
