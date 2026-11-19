import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
  ServerConfig,
  ServerNpmReleaseError,
} from "@supaterm/contracts";
import { expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";

import { makeNpmReleaseAtom, npmReleaseFailureMessage } from "./npmRelease";

const version = "0.0.46-nightly.20261012.3021";
const first = EnvironmentId.make("first");
const second = EnvironmentId.make("second");
const decodeServerConfig = Schema.decodeUnknownSync(ServerConfig);

const configFor = (environmentId: EnvironmentId | null, supported = true) =>
  decodeServerConfig({
    environment: {
      environmentId,
      label: environmentId,
      platform: { os: "linux", arch: "x64" },
      serverVersion: version,
      orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
      capabilities: {
        repositoryIdentity: true,
        ...(supported ? { npmReleaseLookup: true } : {}),
      },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "test",
    },
    cwd: "/test",
    keybindingsConfigPath: "/test/keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/test/logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {},
  });

function setup(options: {
  readonly supports?: (environmentId: EnvironmentId | null) => boolean;
  readonly release?: (environmentId: EnvironmentId) => {
    readonly version: string;
    readonly databaseMigration?: number;
  };
}) {
  const query =
    vi.fn<(request: { environmentId: EnvironmentId; input: { spec: string } }) => void>();
  const publicRequests: Array<string> = [];
  const primaryEnvironmentIdAtom = Atom.make<EnvironmentId | null>(null);
  const npmReleaseAtom = makeNpmReleaseAtom({
    primaryEnvironmentIdAtom,
    connectedEnvironmentIdsAtom: Atom.make([first, second]),
    configValueAtom: (environmentId) =>
      Atom.make(configFor(environmentId, options.supports?.(environmentId) ?? true)),
    serverRelease: (request) => {
      query(request);
      return Atom.make(
        AsyncResult.success(options.release?.(request.environmentId) ?? { version }),
      );
    },
    httpClient: Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        publicRequests.push(request.url);
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({ version, supaterm: { databaseMigration: 7 } }),
          ),
        );
      }),
    ),
  });
  return { query, publicRequests, primaryEnvironmentIdAtom, npmReleaseAtom };
}

it.effect(
  "resolves track metadata through the primary environment and follows primary changes",
  () =>
    Effect.gen(function* () {
      const { npmReleaseAtom, primaryEnvironmentIdAtom } = setup({
        release: (environmentId) => ({
          version,
          databaseMigration: environmentId === first ? 42 : 43,
        }),
      });
      const registry = AtomRegistry.make();
      const release = npmReleaseAtom("nightly");
      registry.set(primaryEnvironmentIdAtom, first);
      const unmount = registry.mount(release);
      try {
        expect(
          yield* AtomRegistry.getResult(registry, release, { suspendOnWaiting: true }),
        ).toEqual({
          version,
          databaseMigration: 42,
        });
        registry.set(primaryEnvironmentIdAtom, second);
        expect(
          yield* AtomRegistry.getResult(registry, release, { suspendOnWaiting: true }),
        ).toEqual({
          version,
          databaseMigration: 43,
        });
      } finally {
        unmount();
        registry.dispose();
      }
    }),
);

it.effect("resolves track metadata through a supporting server when there is no primary", () =>
  Effect.gen(function* () {
    const { query, npmReleaseAtom } = setup({
      supports: (environmentId) => environmentId !== first,
    });
    const registry = AtomRegistry.make();
    const release = npmReleaseAtom("nightly");
    const unmount = registry.mount(release);
    try {
      expect(yield* AtomRegistry.getResult(registry, release, { suspendOnWaiting: true })).toEqual({
        version,
        databaseMigration: undefined,
      });
      expect(query).toHaveBeenCalledWith({ environmentId: second, input: { spec: "nightly" } });
    } finally {
      unmount();
      registry.dispose();
    }
  }),
);

it.effect("asks public npm, not the missing RPC, for an older primary server", () =>
  Effect.gen(function* () {
    const { query, publicRequests, npmReleaseAtom, primaryEnvironmentIdAtom } = setup({
      supports: () => false,
    });
    const registry = AtomRegistry.make();
    registry.set(primaryEnvironmentIdAtom, first);
    const release = npmReleaseAtom("latest");
    const unmount = registry.mount(release);
    try {
      expect(yield* AtomRegistry.getResult(registry, release, { suspendOnWaiting: true })).toEqual({
        version,
        databaseMigration: 7,
      });
      expect(query).not.toHaveBeenCalled();
      expect(publicRequests).toEqual(["https://registry.npmjs.org/supaterm/latest"]);
    } finally {
      unmount();
      registry.dispose();
    }
  }),
);

it("only displays the safe release error, not arbitrary transport diagnostics", () => {
  const error = new ServerNpmReleaseError({ reason: "Install npm on the server's PATH." });
  expect(npmReleaseFailureMessage(Cause.fail(error))).toBe(error.message);
  expect(
    npmReleaseFailureMessage(Cause.fail(new Error("sensitive transport details"))),
  ).not.toContain("sensitive");
});
