import type { EnvironmentId } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import type {
  PushDescribeResult,
  PushKinds,
  PushListResult,
  PushNotificationErrorReason,
  PushPreviewLevel,
  PushRegisterInput,
  PushTestResult,
} from "@supaterm/contracts/push";
import type {
  PushInstallation,
  PushNativeConfiguration,
  SupatermPushModule,
} from "@supaterm/mobile-push";

import type {
  MobilePushRegistration,
  MobilePushRetiredHandle,
  MobilePushSettings,
} from "../../persistence/mobile-push-store";
import { PushGatewayError, type PushGatewayClient } from "./pushGateway";

export type PushEnvironmentState =
  | { readonly state: "off" }
  | { readonly state: "unsupported" }
  | { readonly state: "permission-denied" }
  | { readonly state: "verifying" }
  | { readonly state: "waiting" }
  | { readonly state: "active"; readonly lastDeliveryAt: string | null }
  | { readonly state: "revoked" }
  | { readonly state: "origin-not-allowed"; readonly origin: string }
  | { readonly state: "host-unsupported" }
  | { readonly state: "host-disabled" }
  | { readonly state: "gateway-unreachable"; readonly message: string }
  | { readonly state: "error"; readonly message: string };

export type PushDeviceState =
  | { readonly state: "off" }
  | { readonly state: "unsupported" }
  | { readonly state: "permission-denied" }
  | { readonly state: "verifying" }
  | { readonly state: "ready" }
  | { readonly state: "gateway-unreachable"; readonly message: string }
  | { readonly state: "error"; readonly message: string };

export interface PushStatusSnapshot {
  readonly device: PushDeviceState;
  readonly environments: ReadonlyMap<EnvironmentId, PushEnvironmentState>;
}

export type PushPermission = "granted" | "denied" | "undetermined";

export type PushNative = Omit<SupatermPushModule, "getHideContent" | "setHideContent">;

export interface PushHost {
  readonly describe: (environmentId: EnvironmentId) => Promise<PushDescribeResult>;
  readonly register: (environmentId: EnvironmentId, input: PushRegisterInput) => Promise<unknown>;
  readonly unregister: (environmentId: EnvironmentId, registrationId: string) => Promise<unknown>;
  readonly list: (environmentId: EnvironmentId) => Promise<PushListResult>;
  readonly test: (environmentId: EnvironmentId, registrationId: string) => Promise<PushTestResult>;
}

export interface PushChallenge {
  readonly enrollmentId: string;
  readonly code: string;
}

export class PushChallengeTimeoutError extends Error {
  constructor() {
    super("Supaterm could not verify this device. Keep the app open and try again.");
    this.name = "PushChallengeTimeoutError";
  }
}

export interface PushChallengeMailbox {
  readonly deliver: (challenge: PushChallenge) => void;
  readonly wait: (enrollmentId: string, timeoutMs: number) => Promise<string>;
  /** Ends every pending wait, so turning push off does not queue behind an unanswered challenge. */
  readonly abort: () => void;
}

const MAX_EARLY_CHALLENGES = 8;

/** The challenge push can arrive before the enrollment response that names it, so early codes wait here. */
export function createPushChallengeMailbox(): PushChallengeMailbox {
  const arrived = new Map<string, string>();
  const waiters = new Map<string, (code: string | null) => void>();
  return {
    deliver: ({ enrollmentId, code }) => {
      const waiter = waiters.get(enrollmentId);
      if (waiter) {
        waiters.delete(enrollmentId);
        waiter(code);
        return;
      }
      arrived.set(enrollmentId, code);
      for (const key of arrived.keys()) {
        if (arrived.size <= MAX_EARLY_CHALLENGES) break;
        arrived.delete(key);
      }
    },
    wait: (enrollmentId, timeoutMs) => {
      const early = arrived.get(enrollmentId);
      if (early !== undefined) {
        arrived.delete(enrollmentId);
        return Promise.resolve(early);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(enrollmentId);
          reject(new PushChallengeTimeoutError());
        }, timeoutMs);
        waiters.set(enrollmentId, (code) => {
          clearTimeout(timer);
          if (code === null) reject(new PushChallengeTimeoutError());
          else resolve(code);
        });
      });
    },
    abort: () => {
      const pending = [...waiters.values()];
      waiters.clear();
      for (const waiter of pending) waiter(null);
    },
  };
}

export type PushHostFailure = PushNotificationErrorReason | "unsupported" | "offline" | "error";

/** Hosts from before push answer `push.*` with an unknown-tag defect rather than a typed error. */
export function classifyPushHostFailure(error: unknown): PushHostFailure {
  if (error !== null && typeof error === "object" && "_tag" in error) {
    if (error._tag === "PushNotificationError" && "reason" in error) {
      return error.reason as PushNotificationErrorReason;
    }
    if (error._tag === "EnvironmentRpcUnavailableError") return "offline";
  }
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("Unknown request tag") ? "unsupported" : "error";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

function hostFailureState(error: unknown): PushEnvironmentState {
  switch (classifyPushHostFailure(error)) {
    case "unsupported":
      return { state: "host-unsupported" };
    case "disabled":
      return { state: "host-disabled" };
    case "offline":
      return { state: "waiting" };
    default:
      return {
        state: "error",
        message: errorMessage(error, "The host rejected the registration."),
      };
  }
}

type PushSetupFailure =
  | { readonly state: "gateway-unreachable"; readonly message: string }
  | { readonly state: "error"; readonly message: string };

function gatewayFailureState(error: unknown): PushSetupFailure {
  if (error instanceof PushGatewayError && error.unreachable) {
    return { state: "gateway-unreachable", message: error.message };
  }
  return { state: "error", message: errorMessage(error, "Push notification setup failed.") };
}

class InstallationLostError extends Error {
  constructor(readonly gatewayError: unknown) {
    super("The push gateway no longer knows this device.");
  }
}

class PushCancelledError extends Error {}

const noop = () => {};

/** One reconciliation pass. Turning push off or forgetting an environment cancels the active one. */
interface Pass {
  readonly cancelled: () => boolean;
  /** Stops the pass before its next step once it was cancelled. */
  readonly check: () => void;
  /**
   * Abandoning an enrollment step leaves nothing behind but a gateway enrollment that expires,
   * so a cancelled pass stops waiting on one at once instead of after the HTTP response or challenge.
   */
  readonly abandonable: <A>(start: () => Promise<A>) => Promise<A>;
  readonly cancel: () => void;
}

function createPass(): Pass {
  let cancelled = false;
  let reject: (error: PushCancelledError) => void = noop;
  const cancellation = new Promise<never>((_, onCancel) => {
    reject = onCancel;
  });
  cancellation.catch(noop);
  const check = () => {
    if (cancelled) throw new PushCancelledError();
  };
  return {
    cancelled: () => cancelled,
    check,
    abandonable: async (start) => {
      check();
      return Promise.race([cancellation, start()]);
    },
    cancel: () => {
      cancelled = true;
      reject(new PushCancelledError());
    },
  };
}

const installationLost = (error: unknown) =>
  error instanceof PushGatewayError && error.installationLost;

type SupportedConfiguration = Extract<PushNativeConfiguration, { supported: true }>;

const CHALLENGE_MIN_WAIT_MS = 60_000;
const CHALLENGE_MAX_WAIT_MS = 10 * 60_000;
/**
 * Every challenge is a visible alert and the gateway allows a handful per token an hour,
 * so the reconnects, token callbacks, and app-state changes that each sync must not
 * each enroll again after a failure. Only the user's retry skips the wait.
 */
const ENROLL_RETRY_MS = 60_000;

export interface PushRegistrarDeps {
  readonly native: PushNative;
  readonly gateway: PushGatewayClient;
  readonly host: PushHost;
  readonly permissions: {
    readonly get: () => Promise<PushPermission>;
    readonly request: () => Promise<PushPermission>;
  };
  readonly deviceToken: () => Promise<string>;
  readonly store: {
    readonly load: () => Promise<MobilePushSettings>;
    readonly save: (settings: MobilePushSettings) => Promise<void>;
  };
  readonly challenges: PushChallengeMailbox;
  readonly randomId: () => string;
  readonly deviceName?: string;
  readonly now?: () => number;
  readonly onStatus: (snapshot: PushStatusSnapshot) => void;
}

export interface PushEnvironments {
  readonly saved: ReadonlySet<EnvironmentId>;
  readonly connected: ReadonlySet<EnvironmentId>;
}

export interface PushRegistrar {
  /** Converges gateway, host, and Keychain state with the settings. Safe to call on every reconnect. */
  readonly sync: (environments: PushEnvironments) => Promise<void>;
  /** Like sync, but enrolls again at once instead of waiting out a recent enrollment failure. */
  readonly retry: (environments: PushEnvironments) => Promise<void>;
  readonly enable: (preview: PushPreviewLevel) => Promise<void>;
  /** Saves the choice and cancels any setup in progress before cleaning up. */
  readonly disable: () => Promise<void>;
  readonly updatePreferences: (patch: {
    readonly preview?: PushPreviewLevel;
    readonly kinds?: PushKinds;
  }) => Promise<void>;
  /** Removes the environment's registration before the environment itself is forgotten. */
  readonly forgetEnvironment: (environmentId: EnvironmentId) => Promise<void>;
  /** Registers an environment again after its owner removed this device there. */
  readonly resumeEnvironment: (environmentId: EnvironmentId) => Promise<void>;
  readonly sendTest: (environmentId: EnvironmentId) => Promise<PushTestResult["status"]>;
}

const sameKinds = (left: PushKinds, right: PushKinds) =>
  left.approval === right.approval &&
  left.input === right.input &&
  left.completion === right.completion &&
  left.failure === right.failure &&
  left["usage-limit"] === right["usage-limit"];

const withoutEnvironment = (
  environments: PushEnvironments,
  environmentId: EnvironmentId,
): PushEnvironments => ({
  saved: new Set([...environments.saved].filter((id) => id !== environmentId)),
  connected: new Set([...environments.connected].filter((id) => id !== environmentId)),
});

export function createPushRegistrar(deps: PushRegistrarDeps): PushRegistrar {
  const now = deps.now ?? Date.now;
  let enrollFailure: { readonly until: number; readonly error: unknown } | null = null;
  let passes: Promise<unknown> = Promise.resolve();
  let mutations: Promise<unknown> = Promise.resolve();
  let environments: PushEnvironments = { saved: new Set(), connected: new Set() };
  // Reconnects can fire in bursts; passes that have not started yet collapse into one.
  let latestEnvironments = environments;
  let queuedPass: Promise<void> | null = null;
  let activePass: Pass | null = null;
  // Environments being forgotten are unregistered from the host while it still answers; their
  // callers wait only for that, not for the rest of the pass.
  const forgetting = new Map<EnvironmentId, Array<() => void>>();
  let settings: MobilePushSettings | null = null;
  let device: PushDeviceState = { state: "off" };
  const states = new Map<EnvironmentId, PushEnvironmentState>();

  const publish = () => {
    for (const environmentId of states.keys()) {
      if (!environments.saved.has(environmentId)) states.delete(environmentId);
    }
    deps.onStatus({ device, environments: new Map(states) });
  };

  const settleAll = (state: Extract<PushDeviceState, PushEnvironmentState>) => {
    device = state;
    for (const environmentId of environments.saved) states.set(environmentId, state);
    publish();
  };

  const load = async () => (settings ??= await deps.store.load());

  /** Every write goes through here, so a pass and the user's own changes never overwrite each other. */
  const update = (change: (current: MobilePushSettings) => MobilePushSettings): Promise<void> => {
    const run = mutations.then(async () => {
      const next = change(await load());
      settings = next;
      await deps.store.save(next);
    });
    mutations = run.then(noop, noop);
    return run;
  };

  const read = () => mutations.then(load);

  const findRegistration = async (environmentId: EnvironmentId) =>
    (await load()).registrations.find((candidate) => candidate.environmentId === environmentId);

  /** Deletes the handle at the gateway, or keeps it for a later retry when the gateway is down. */
  const dropHandle = async (installationId: string, handle: string) => {
    const installation = await deps.native.getInstallation();
    if (installation?.installationId !== installationId) return;
    try {
      await deps.gateway.deleteHandle(installation, handle);
    } catch (error) {
      if (installationLost(error)) return;
      await update((current) => ({
        ...current,
        retiredHandles: [...current.retiredHandles, { installationId, handle }],
      }));
    }
  };

  const retryRetiredHandles = async (installation: PushInstallation | null) => {
    const retired = (await load()).retiredHandles;
    if (retired.length === 0) return;
    const settled = new Set<MobilePushRetiredHandle>();
    for (const entry of retired) {
      if (installation?.installationId !== entry.installationId) {
        settled.add(entry);
        continue;
      }
      try {
        await deps.gateway.deleteHandle(installation, entry.handle);
        settled.add(entry);
      } catch (error) {
        if (installationLost(error)) settled.add(entry);
      }
    }
    await update((current) => ({
      ...current,
      retiredHandles: current.retiredHandles.filter((entry) => !settled.has(entry)),
    }));
  };

  const retire = async (registration: MobilePushRegistration, options: { host: boolean }) => {
    if (options.host) {
      await deps.host
        .unregister(registration.environmentId, registration.registrationId)
        .catch(noop);
    }
    await deps.native.deleteBinding(registration.registrationId).catch(noop);
    await update((current) => ({
      ...current,
      registrations: current.registrations.filter(
        (candidate) => candidate.registrationId !== registration.registrationId,
      ),
    }));
    await dropHandle(registration.installationId, registration.handle);
  };

  /** Deleting the installation drops every handle at once; local state goes only once it is gone. */
  const deleteInstallation = async () => {
    const installation = await deps.native.getInstallation();
    if (installation === null) return;
    try {
      await deps.gateway.deleteInstallation(installation);
    } catch (error) {
      if (!installationLost(error)) return;
    }
    await deps.native.clearInstallation();
  };

  const removeStrayBindings = async () => {
    const current = await load();
    const known = new Set(current.registrations.map((registration) => registration.registrationId));
    for (const binding of await deps.native.listBindings()) {
      if (!known.has(binding.registrationId)) {
        await deps.native.deleteBinding(binding.registrationId).catch(noop);
      }
    }
    await deps.native.deleteOrphanKeys().catch(noop);
  };

  const ensureInstallation = async (
    pass: Pass,
    config: SupportedConfiguration,
  ): Promise<PushInstallation> => {
    const token = await pass.abandonable(deps.deviceToken);
    const current = await deps.native.getInstallation();
    pass.check();
    const sameDestination =
      current !== null &&
      current.topic === config.topic &&
      current.environment === config.apnsEnvironment;
    if (sameDestination && current.token === token) return current;

    if (enrollFailure !== null && now() < enrollFailure.until) throw enrollFailure.error;
    device = { state: "verifying" };
    const { revokedEnvironments } = await load();
    for (const environmentId of environments.saved) {
      if (environments.connected.has(environmentId) && !revokedEnvironments.includes(environmentId))
        states.set(environmentId, { state: "verifying" });
    }
    publish();

    const request = { token, topic: config.topic, environment: config.apnsEnvironment };
    let owner = sameDestination ? current : null;
    let confirmed;
    try {
      let enrollment;
      try {
        enrollment = await pass.abandonable(() => deps.gateway.enroll(request, owner ?? undefined));
      } catch (error) {
        if (owner === null || !installationLost(error)) {
          throw error;
        }
        owner = null;
        enrollment = await pass.abandonable(() => deps.gateway.enroll(request));
      }
      const { enrollmentId, expiresAt } = enrollment;
      const waitMs = Math.min(
        CHALLENGE_MAX_WAIT_MS,
        Math.max(CHALLENGE_MIN_WAIT_MS, expiresAt - now()),
      );
      const code = await pass.abandonable(() => deps.challenges.wait(enrollmentId, waitMs));
      confirmed = await pass.abandonable(() => deps.gateway.confirm(enrollmentId, code));
    } catch (error) {
      pass.check();
      const waitMs =
        error instanceof PushGatewayError && error.retryAfterMs !== null
          ? Math.max(error.retryAfterMs, ENROLL_RETRY_MS)
          : ENROLL_RETRY_MS;
      enrollFailure = { until: now() + waitMs, error };
      throw error;
    }
    enrollFailure = null;
    const ownerToken = confirmed.ownerToken ?? owner?.ownerToken;
    if (ownerToken === undefined) {
      throw new PushGatewayError({ status: 502, code: "invalid_response" });
    }
    const next: PushInstallation = {
      installationId: confirmed.installationId,
      ownerToken,
      token,
      topic: config.topic,
      environment: config.apnsEnvironment,
    };
    // Kept even when cancelled meanwhile, so the cleanup that follows deletes it at the gateway.
    await deps.native.setInstallation(next);
    if (current !== null && current.installationId !== next.installationId) {
      await deps.gateway.deleteInstallation(current).catch(noop);
    }
    pass.check();
    return next;
  };

  const mintHandle = async (installation: PushInstallation, hostKey: string) => {
    try {
      return await deps.gateway.createHandle(installation, hostKey);
    } catch (error) {
      throw installationLost(error) ? new InstallationLostError(error) : error;
    }
  };

  const registerInput = (
    registration: Pick<
      MobilePushRegistration,
      "registrationId" | "keyId" | "publicKey" | "handle" | "gatewayOrigin"
    >,
    current: MobilePushSettings,
  ): PushRegisterInput => ({
    registrationId: registration.registrationId,
    gatewayOrigin: registration.gatewayOrigin,
    handle: registration.handle,
    recipientKey: { keyId: registration.keyId, publicKey: registration.publicKey },
    preview: current.preview,
    kinds: current.kinds,
    ...(deps.deviceName ? { deviceName: deps.deviceName.slice(0, 64) } : {}),
  });

  const saveRegistration = (registration: MobilePushRegistration) =>
    update((current) => ({
      ...current,
      registrations: [
        ...current.registrations.filter(
          (candidate) => candidate.environmentId !== registration.environmentId,
        ),
        registration,
      ],
    }));

  const refreshRegistration = async (
    pass: Pass,
    existing: MobilePushRegistration,
    installation: PushInstallation,
  ): Promise<PushEnvironmentState | null> => {
    const current = await load();
    const remote = (await deps.host.list(existing.environmentId)).registrations.find(
      (registration) => registration.registrationId === existing.registrationId,
    );
    pass.check();
    // The host deletes a registration only when its owner removes it; one marked gone instead
    // lost its handle at the gateway and is set up again below.
    if (remote === undefined) {
      await retire(existing, { host: false });
      await update((settings) => ({
        ...settings,
        revokedEnvironments: [
          ...settings.revokedEnvironments.filter((id) => id !== existing.environmentId),
          existing.environmentId,
        ],
      }));
      return { state: "revoked" };
    }
    const handleUsable =
      existing.installationId === installation.installationId && remote.status !== "gone";
    const lastDeliveryAt =
      remote.lastDeliveryAt === undefined ? null : DateTime.formatIso(remote.lastDeliveryAt);
    if (
      handleUsable &&
      remote.status === "active" &&
      existing.preview === current.preview &&
      sameKinds(existing.kinds, current.kinds)
    ) {
      return { state: "active", lastDeliveryAt };
    }
    const handle = handleUsable
      ? existing.handle
      : await mintHandle(installation, existing.hostKey);
    if (pass.cancelled()) {
      if (handle !== existing.handle) await dropHandle(installation.installationId, handle);
      pass.check();
    }
    try {
      await deps.host.register(
        existing.environmentId,
        registerInput({ ...existing, handle }, current),
      );
    } catch (error) {
      if (handle !== existing.handle) await dropHandle(installation.installationId, handle);
      if (classifyPushHostFailure(error) === "conflict") {
        await retire(existing, { host: false });
        return null;
      }
      throw error;
    }
    await saveRegistration({
      ...existing,
      handle,
      installationId: installation.installationId,
      preview: current.preview,
      kinds: current.kinds,
    });
    if (handle !== existing.handle) {
      await dropHandle(existing.installationId, existing.handle);
    }
    return { state: "active", lastDeliveryAt };
  };

  const createRegistration = async (
    pass: Pass,
    environmentId: EnvironmentId,
    describe: PushDescribeResult,
    installation: PushInstallation,
  ): Promise<PushEnvironmentState> => {
    const current = await load();
    const key = await deps.native.generateRecipientKey();
    const handle = await mintHandle(installation, describe.hostKey);
    if (pass.cancelled()) {
      await dropHandle(installation.installationId, handle);
      pass.check();
    }
    const registration: MobilePushRegistration = {
      environmentId,
      registrationId: deps.randomId().toLowerCase(),
      keyId: key.keyId,
      publicKey: key.publicKey,
      hostKey: describe.hostKey,
      handle,
      gatewayOrigin: deps.gateway.origin,
      installationId: installation.installationId,
      preview: current.preview,
      kinds: current.kinds,
    };
    // The binding exists before the host can send, so the first alert already decrypts.
    await deps.native.saveBinding({
      registrationId: registration.registrationId,
      keyId: registration.keyId,
      environmentId,
      hostKey: registration.hostKey,
    });
    try {
      await deps.host.register(environmentId, registerInput(registration, current));
    } catch (error) {
      await deps.native.deleteBinding(registration.registrationId).catch(noop);
      await dropHandle(installation.installationId, handle);
      throw error;
    }
    // Saved even when cancelled meanwhile, so the cleanup that follows unregisters it.
    await saveRegistration(registration);
    return { state: "active", lastDeliveryAt: null };
  };

  const registerEnvironment = async (
    pass: Pass,
    environmentId: EnvironmentId,
    installation: PushInstallation,
  ): Promise<PushEnvironmentState> => {
    let describe: PushDescribeResult;
    try {
      describe = await deps.host.describe(environmentId);
    } catch (error) {
      return hostFailureState(error);
    }
    pass.check();
    if (!describe.enabled) return { state: "host-disabled" };
    if (!describe.gatewayOrigins.includes(deps.gateway.origin)) {
      return { state: "origin-not-allowed", origin: deps.gateway.origin };
    }
    try {
      const existing = await findRegistration(environmentId);
      if (existing !== undefined) {
        const bound = (await deps.native.listBindings()).some(
          (binding) =>
            binding.registrationId === existing.registrationId && binding.keyId === existing.keyId,
        );
        if (
          !bound ||
          existing.hostKey !== describe.hostKey ||
          existing.gatewayOrigin !== deps.gateway.origin
        ) {
          await retire(existing, { host: true });
        } else {
          const refreshed = await refreshRegistration(pass, existing, installation);
          if (refreshed !== null) return refreshed;
        }
      }
      pass.check();
      return await createRegistration(pass, environmentId, describe, installation);
    } catch (error) {
      if (error instanceof InstallationLostError || error instanceof PushCancelledError) {
        throw error;
      }
      if (error instanceof PushGatewayError) return gatewayFailureState(error);
      return hostFailureState(error);
    }
  };

  /** Brings every saved environment up to date with one installation, or stops when the gateway lost it. */
  const registerEnvironments = async (
    pass: Pass,
    installation: PushInstallation,
  ): Promise<InstallationLostError | null> => {
    for (const environmentId of environments.saved) {
      pass.check();
      let state: PushEnvironmentState;
      if ((await load()).revokedEnvironments.includes(environmentId)) {
        state = { state: "revoked" };
      } else if (!environments.connected.has(environmentId)) {
        const registration = await findRegistration(environmentId);
        state =
          registration?.installationId === installation.installationId
            ? { state: "active", lastDeliveryAt: null }
            : { state: "waiting" };
      } else {
        try {
          state = await registerEnvironment(pass, environmentId, installation);
        } catch (error) {
          if (error instanceof InstallationLostError) return error;
          throw error;
        }
      }
      pass.check();
      states.set(environmentId, state);
      publish();
    }
    return null;
  };

  const enrollDevice = async (
    pass: Pass,
    config: SupportedConfiguration,
  ): Promise<PushInstallation | null> => {
    let installation: PushInstallation;
    try {
      installation = await ensureInstallation(pass, config);
    } catch (error) {
      if (error instanceof PushCancelledError) throw error;
      settleAll(gatewayFailureState(error));
      return null;
    }
    device = { state: "ready" };
    await retryRetiredHandles(installation);
    return installation;
  };

  const reconcile = async (pass: Pass) => {
    const current = await read();
    for (const registration of current.registrations) {
      if (!environments.saved.has(registration.environmentId)) {
        await retire(registration, { host: forgetting.has(registration.environmentId) });
      }
    }
    for (const [environmentId, waiters] of forgetting) {
      if (environments.saved.has(environmentId)) continue;
      forgetting.delete(environmentId);
      for (const resolve of waiters) resolve();
    }
    if (current.revokedEnvironments.some((id) => !environments.saved.has(id))) {
      await update((settings) => ({
        ...settings,
        revokedEnvironments: settings.revokedEnvironments.filter((id) =>
          environments.saved.has(id),
        ),
      }));
    }
    const config = deps.native.configuration();
    if (!current.enabled || !config.supported) {
      if (config.supported) {
        for (const registration of (await load()).registrations) {
          await retire(registration, {
            host: environments.connected.has(registration.environmentId),
          });
        }
        await retryRetiredHandles(await deps.native.getInstallation());
        await deleteInstallation();
        await removeStrayBindings();
      }
      settleAll(config.supported ? { state: "off" } : { state: "unsupported" });
      return;
    }

    if ((await deps.permissions.get()) !== "granted") {
      await deleteInstallation();
      settleAll({ state: "permission-denied" });
      return;
    }
    pass.check();

    let installation = await enrollDevice(pass, config);
    if (installation === null) return;
    let lost = await registerEnvironments(pass, installation);
    if (lost !== null) {
      // A lost installation takes every handle with it, including those minted earlier in this
      // pass, so recovery enrolls once more and brings every environment up again.
      await deps.native.clearInstallation();
      installation = await enrollDevice(pass, config);
      if (installation === null) return;
      lost = await registerEnvironments(pass, installation);
      if (lost !== null) {
        settleAll(gatewayFailureState(lost.gatewayError));
        return;
      }
    }
    await removeStrayBindings();
    publish();
  };

  const runPass = async () => {
    environments = latestEnvironments;
    const pass = createPass();
    activePass = pass;
    try {
      await reconcile(pass);
    } catch (error) {
      if (!(error instanceof PushCancelledError)) throw error;
    } finally {
      if (activePass === pass) activePass = null;
    }
  };

  const requestPass = (): Promise<void> => {
    if (queuedPass !== null) return queuedPass;
    const run = passes.then(() => {
      queuedPass = null;
      return runPass();
    });
    passes = run.then(noop, noop);
    queuedPass = run;
    return run;
  };

  /** A pass already waiting on enrollment would otherwise hold the queue for up to ten minutes. */
  const cancelActivePass = () => {
    activePass?.cancel();
    deps.challenges.abort();
  };

  return {
    sync: (next) => {
      latestEnvironments = next;
      return requestPass();
    },
    retry: (next) => {
      enrollFailure = null;
      latestEnvironments = next;
      return requestPass();
    },
    enable: async (preview) => {
      enrollFailure = null;
      await update((current) => ({ ...current, enabled: true, preview }));
      await deps.permissions.request();
      await requestPass();
    },
    disable: async () => {
      cancelActivePass();
      await update((current) => ({ ...current, enabled: false }));
      await requestPass();
    },
    updatePreferences: async (patch) => {
      await update((current) => ({ ...current, ...patch }));
      await requestPass();
    },
    forgetEnvironment: (environmentId) => {
      cancelActivePass();
      latestEnvironments = withoutEnvironment(latestEnvironments, environmentId);
      const forgotten = new Promise<void>((resolve) => {
        forgetting.set(environmentId, [...(forgetting.get(environmentId) ?? []), resolve]);
      });
      return Promise.race([forgotten, requestPass()]);
    },
    resumeEnvironment: async (environmentId) => {
      await update((current) => ({
        ...current,
        revokedEnvironments: current.revokedEnvironments.filter((id) => id !== environmentId),
      }));
      await requestPass();
    },
    sendTest: async (environmentId) => {
      const registration = await findRegistration(environmentId);
      if (registration === undefined) {
        throw new Error("Notifications are not set up for this environment yet.");
      }
      const result = await deps.host.test(environmentId, registration.registrationId);
      if (result.status === "gone") await requestPass();
      return result.status;
    },
  };
}
