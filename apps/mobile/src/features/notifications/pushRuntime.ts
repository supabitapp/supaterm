import {
  createEnvironmentRpcCommand,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@supaterm/client-runtime/state/runtime";
import { WS_METHODS, type EnvironmentId } from "@supaterm/contracts";
import { DEFAULT_PUSH_GATEWAY_ORIGIN, normalizePushGatewayOrigin } from "@supaterm/contracts/push";
import SupatermPush from "@supaterm/mobile-push";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { connectionAtomRuntime } from "../../connection/runtime";
import { runtime } from "../../lib/runtime";
import { uuidv4 } from "../../lib/uuid";
import * as MobilePushStore from "../../persistence/mobile-push-store";
import { appAtomRegistry } from "../../state/atom-registry";
import { createPushGatewayClient } from "./pushGateway";
import {
  createPushChallengeMailbox,
  createPushRegistrar,
  type PushPermission,
  type PushRegistrar,
  type PushStatusSnapshot,
} from "./pushRegistrar";

export const pushCommands = {
  describe: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:push:describe",
    tag: WS_METHODS.pushDescribe,
  }),
  register: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:push:register",
    tag: WS_METHODS.pushRegister,
  }),
  unregister: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:push:unregister",
    tag: WS_METHODS.pushUnregister,
  }),
  list: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:push:list",
    tag: WS_METHODS.pushList,
  }),
  test: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:push:test",
    tag: WS_METHODS.pushTest,
  }),
};

const HOST_TIMEOUT_MS = 20_000;
const DEVICE_TOKEN_TIMEOUT_MS = 30_000;

/** Push setup runs serially, so a host or APNs that never answers must not stall it forever. */
async function withTimeout<A>(promise: Promise<A>, timeoutMs: number, message: string): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function runPushCommand<I, A, E>(
  command: AtomCommand<{ readonly environmentId: EnvironmentId; readonly input: I }, A, E>,
  environmentId: EnvironmentId,
  input: I,
): Promise<A> {
  const result = await withTimeout(
    command.run(appAtomRegistry, { environmentId, input }),
    HOST_TIMEOUT_MS,
    "The environment did not answer in time.",
  );
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

export const pushGatewayOrigin =
  normalizePushGatewayOrigin(String(Constants.expoConfig?.extra?.pushGatewayUrl ?? "")) ??
  DEFAULT_PUSH_GATEWAY_ORIGIN;

export const pushStatusAtom = Atom.make<PushStatusSnapshot>({
  device: { state: "off" },
  environments: new Map(),
}).pipe(Atom.keepAlive, Atom.withLabel("mobile:push:status"));

export const pushSettingsAtom = Atom.make<MobilePushStore.MobilePushSettings | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:push:settings"),
);

export const pushHideContentAtom = Atom.make<boolean | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:push:hide-content"),
);

export const pushChallenges = createPushChallengeMailbox();

function permissionOf(response: Notifications.NotificationPermissionsStatus): PushPermission {
  const status = response.ios?.status;
  if (
    response.granted ||
    status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    status === Notifications.IosAuthorizationStatus.EPHEMERAL
  ) {
    return "granted";
  }
  return response.status === "undetermined" ? "undetermined" : "denied";
}

const runStore = <A, E>(
  use: (store: MobilePushStore.MobilePushStore["Service"]) => Effect.Effect<A, E>,
) => runtime.runPromise(MobilePushStore.MobilePushStore.pipe(Effect.flatMap(use)));

let registrar: PushRegistrar | null | undefined;

/** Null on Android and on iOS builds without the push extension, such as personal-team builds. */
export function pushRegistrar(): PushRegistrar | null {
  if (registrar !== undefined) return registrar;
  const native = SupatermPush;
  if (Platform.OS !== "ios" || native === null || !native.configuration().supported) {
    registrar = null;
    return registrar;
  }
  registrar = createPushRegistrar({
    native,
    gateway: createPushGatewayClient(pushGatewayOrigin),
    host: {
      describe: (environmentId) => runPushCommand(pushCommands.describe, environmentId, {}),
      register: (environmentId, input) =>
        runPushCommand(pushCommands.register, environmentId, input),
      unregister: (environmentId, registrationId) =>
        runPushCommand(pushCommands.unregister, environmentId, { registrationId }),
      list: (environmentId) => runPushCommand(pushCommands.list, environmentId, {}),
      test: (environmentId, registrationId) =>
        runPushCommand(pushCommands.test, environmentId, { registrationId }),
    },
    permissions: {
      get: async () => permissionOf(await Notifications.getPermissionsAsync()),
      request: async () =>
        permissionOf(
          await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowSound: true, allowBadge: false },
          }),
        ),
    },
    deviceToken: async () => {
      const token = await withTimeout(
        Notifications.getDevicePushTokenAsync(),
        DEVICE_TOKEN_TIMEOUT_MS,
        "iOS did not provide a push token. Check the network and try again.",
      );
      if (token.type !== "ios" || typeof token.data !== "string") {
        throw new Error("This device did not return an APNs token.");
      }
      return token.data.toLowerCase();
    },
    store: {
      load: async () => {
        const settings = await runStore((store) => store.load);
        appAtomRegistry.set(pushSettingsAtom, settings);
        return settings;
      },
      save: async (settings) => {
        await runStore((store) => store.save(settings));
        appAtomRegistry.set(pushSettingsAtom, settings);
      },
    },
    challenges: pushChallenges,
    randomId: uuidv4,
    ...(Device.modelName ? { deviceName: Device.modelName } : {}),
    onStatus: (snapshot) => appAtomRegistry.set(pushStatusAtom, snapshot),
  });
  return registrar;
}

export async function loadPushSettings(): Promise<void> {
  appAtomRegistry.set(pushSettingsAtom, await runStore((store) => store.load));
}

export async function loadPushHideContent(): Promise<void> {
  if (SupatermPush === null) return;
  appAtomRegistry.set(pushHideContentAtom, await SupatermPush.getHideContent());
}

export async function setPushHideContent(value: boolean): Promise<void> {
  if (SupatermPush === null) return;
  appAtomRegistry.set(pushHideContentAtom, value);
  try {
    await SupatermPush.setHideContent(value);
  } catch (error) {
    appAtomRegistry.set(pushHideContentAtom, !value);
    throw error;
  }
}

const FORGET_TIMEOUT_MS = 5_000;

/**
 * Unregisters while the environment's session still exists. Removal never waits long on it: a
 * registration left behind is retired by the next sync once the environment is gone.
 */
export async function forgetPushEnvironment(environmentId: EnvironmentId): Promise<void> {
  const current = pushRegistrar();
  if (current === null) return;
  await withTimeout(current.forgetEnvironment(environmentId), FORGET_TIMEOUT_MS, "").catch(
    () => undefined,
  );
}
