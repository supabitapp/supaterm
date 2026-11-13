import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { BearerConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { layerRemoteHttpClient } from "../rpc/http.ts";
import { createPeerPairingCodeCommand } from "./peerPairingCode.ts";
import { squashAtomCommandFailure } from "./runtime.ts";

const environmentId = EnvironmentId.make("environment-vps");
const target = new BearerConnectionTarget({
  environmentId,
  label: "VPS",
  connectionId: "connection-1",
});
const connected: PreparedConnection = {
  environmentId,
  label: "VPS",
  httpBaseUrl: "https://vps.example.test",
  socketUrl: "wss://vps.example.test/ws",
  httpAuthorization: { _tag: "Bearer", token: "bearer-token" },
  target,
};

const mint = Effect.fn(function* (
  prepared: Option.Option<PreparedConnection>,
  reply: () => Response,
) {
  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const supervisor = {
    target,
    prepared: yield* SubscriptionRef.make(prepared),
  } as EnvironmentSupervisor["Service"];
  const runtime = Atom.runtime(
    Layer.merge(
      Layer.succeed(EnvironmentRegistry, {
        run: (_id, effect) => Effect.provideService(effect, EnvironmentSupervisor, supervisor),
      } as EnvironmentRegistry["Service"]),
      layerRemoteHttpClient(async (request, init) => {
        calls.push({ url: String(request), init: init ?? {} });
        return reply();
      }),
    ),
  );
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  const result = yield* Effect.promise(() =>
    createPeerPairingCodeCommand(runtime).run(registry, { environmentId, input: "read-only" }),
  );
  return { calls, result };
});

it.effect("mints a code that carries only the chosen access, as this client's session there", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { calls, result } = yield* mint(Option.some(connected), () =>
        Response.json({
          id: "pairing-1",
          credential: "PAIRCODE",
          expiresAt: "2026-10-01T12:05:00.000Z",
        }),
      );
      expect(result).toMatchObject({ _tag: "Success", value: "PAIRCODE" });
      expect(calls).toHaveLength(1);
      const { url, init } = calls[0]!;
      expect(url).toBe("https://vps.example.test/api/auth/pairing-token");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer bearer-token");
      expect(yield* Effect.promise(() => new Response(init.body).json())).toEqual({
        label: "Supaterm link",
        scopes: ["orchestration:read"],
      });
    }),
  ),
);

it.effect("tells a session that may not create codes from an environment it cannot ask", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const refused = yield* mint(Option.some(connected), () =>
        Response.json(
          {
            _tag: "EnvironmentScopeRequiredError",
            code: "insufficient_scope",
            requiredScope: "access:write",
            traceId: "trace-1",
          },
          { status: 403 },
        ),
      );
      expect(refused.result._tag).toBe("Failure");
      if (refused.result._tag === "Failure") {
        expect(squashAtomCommandFailure(refused.result)).toMatchObject({
          _tag: "PeerPairingCodeError",
          reason: "not_allowed",
        });
      }

      const disconnected = yield* mint(Option.none(), () => Response.json({}));
      expect(disconnected.result._tag).toBe("Failure");
      if (disconnected.result._tag === "Failure") {
        expect(squashAtomCommandFailure(disconnected.result)).toMatchObject({
          _tag: "PeerPairingCodeError",
          reason: "unavailable",
        });
      }
      expect(disconnected.calls).toHaveLength(0);
    }),
  ),
);
