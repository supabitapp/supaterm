import {
  EnvironmentRegistry,
  EnvironmentSupervisor,
  BearerConnectionTarget,
  AVAILABLE_CONNECTION_STATE,
  type ConnectionCatalogEntry,
  type NetworkStatus,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "@supaterm/client-runtime/connection";
import {
  AuthSettingsWriteScope,
  EnvironmentId,
  WS_METHODS,
  type AuthSessionState,
} from "@supaterm/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { RpcSession } from "@supaterm/client-runtime/rpc";
import * as Layer from "effect/Layer";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, vi } from "vite-plus/test";

const fixture = await vi.hoisted(async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const Effect = await import("effect/Effect");
  return {
    sessions: Atom.family((_id: string) =>
      Atom.make<AsyncResult.AsyncResult<AuthSessionState>>(AsyncResult.initial()),
    ),
    request: vi.fn((_method: string, input: { gatewayUrl?: string }) =>
      Effect.succeed({
        gatewayUrl: input.gatewayUrl ?? "https://pool.example",
        signedInAs: "agent",
        tokenSource: "entered" as const,
      }),
    ),
  };
});
vi.mock("@supaterm/client-runtime/state/session", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: fixture.sessions }),
}));
vi.mock("../../../../packages/client-runtime/src/rpc/client.ts", async (original) => ({
  ...(await original<typeof import("@supaterm/client-runtime/rpc")>()),
  requestGuarded: fixture.request,
}));

import { createDeviceSimlockIdentityCheck } from "./deviceIdentity";

const session = (allowed: boolean): AuthSessionState => ({
  authenticated: true,
  scopes: allowed ? [AuthSettingsWriteScope] : [],
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "session",
  },
});

it.effect(
  "uses destination settings permission for reactive identity checks and observes revocation",
  () =>
    Effect.gen(function* () {
      fixture.request.mockClear();
      const registry = AtomRegistry.make();
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const destination = EnvironmentId.make("destination");
      const supervisor = Context.get(
        yield* Layer.build(
          Layer.mock(EnvironmentSupervisor.EnvironmentSupervisor, {
            target: new BearerConnectionTarget({
              environmentId: destination,
              label: "Destination",
              connectionId: "test",
            }),
            state: yield* SubscriptionRef.make<SupervisorConnectionState>(
              AVAILABLE_CONNECTION_STATE,
            ),
            session: yield* SubscriptionRef.make<Option.Option<RpcSession>>(Option.none()),
            prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
          }),
        ),
        EnvironmentSupervisor.EnvironmentSupervisor,
      );
      const runtime = Atom.runtime(
        Layer.mock(EnvironmentRegistry.EnvironmentRegistry, {
          entries: yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
            new Map(),
          ),
          networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
          run: (_id, effect) =>
            Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        }),
      );
      const check = createDeviceSimlockIdentityCheck(runtime);
      const other = EnvironmentId.make("other");
      registry.set(fixture.sessions(destination), AsyncResult.success(session(false)));
      registry.set(fixture.sessions(other), AsyncResult.success(session(true)));
      const target = {
        environmentId: destination,
        input: { gatewayUrl: "https://pool.example", agentToken: "transient-test-token" },
      };
      const atom = check(target);
      registry.mount(atom);
      expect(check({ ...target, input: { ...target.input } })).toBe(atom);
      expect(atom.label?.join(" ")).not.toContain(target.input.agentToken);
      const denied = yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }).pipe(
        Effect.flip,
      );
      expect(denied).toMatchObject({
        _tag: "EnvironmentAuthorizationError",
        requiredScope: AuthSettingsWriteScope,
      });
      expect(fixture.request).not.toHaveBeenCalled();

      registry.set(fixture.sessions(destination), AsyncResult.success(session(true)));
      const allowed = yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
      expect(allowed.signedInAs).toBe("agent");
      expect(fixture.request).toHaveBeenCalledExactlyOnceWith(
        WS_METHODS.deviceSimlockIdentity,
        target.input,
      );

      registry.set(fixture.sessions(destination), AsyncResult.success(session(false)));
      const revoked = yield* AtomRegistry.getResult(registry, atom, {
        suspendOnWaiting: true,
      }).pipe(Effect.flip);
      expect(revoked).toMatchObject({ _tag: "EnvironmentAuthorizationError" });
      expect(fixture.request).toHaveBeenCalledTimes(1);
    }).pipe(Effect.scoped),
);
