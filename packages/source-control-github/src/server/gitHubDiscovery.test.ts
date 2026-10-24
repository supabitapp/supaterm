import { SourceControlProviderKind } from "@supaterm/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestSourceControlHost from "@supaterm/source-control-testing/TestSourceControlHost";

import * as GitHubCredentials from "./GitHubCredentials.ts";
import * as GitHubProviderDiscovery from "./GitHubProviderDiscovery.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";

const unknownContext = (baseUrl: string) => ({
  provider: { kind: SourceControlProviderKind.make("unknown"), name: "Unknown", baseUrl },
  remoteName: "origin",
  remoteUrl: "git@code.example.test:team/project.git",
});

// The default host dies on any command, so refinement never reaches `gh`.
const makeDiscovery = (get: GitHubCredentials.GitHubCredentials["Service"]["get"]) =>
  GitHubProviderDiscovery.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(GitHubRest.GitHubRest)({}),
        Layer.mock(GitHubCredentials.GitHubCredentials)({ get, invalidateAll: Effect.void }),
        TestSourceControlHost.layer(),
      ),
    ),
    Effect.provideService(HostProcess.Environment, {}),
  );

const signedIn = (host: string) =>
  Effect.succeed({
    host,
    token: Redacted.make("token"),
    source: "gh" as const,
    fingerprint: `${host}:fingerprint`,
  });

it.effect.each([
  { name: "a credential", credential: "found", claimed: true },
  { name: "a host turned off in Settings", credential: "disabled", claimed: true },
  { name: "no credential", credential: "missing", claimed: false },
] as const)("claims a custom-host remote with $name", (scenario) =>
  Effect.gen(function* () {
    const hosts: Array<string> = [];
    const discovery = yield* makeDiscovery((host) => {
      hosts.push(host);
      return scenario.credential === "found"
        ? signedIn(host)
        : scenario.credential === "disabled"
          ? Effect.fail(new GitHubCredentials.GitHubHostDisabledError({ host }))
          : Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host }));
    });
    if (discovery.type !== "managed-cli") return assert.fail("expected a managed CLI");
    const provider = yield* discovery.refineUnknownRemote({
      cwd: "/repo",
      context: unknownContext("https://code.example.test"),
    });
    assert.deepStrictEqual(
      provider,
      scenario.claimed
        ? {
            kind: SourceControlProviderKind.make("github"),
            name: "GitHub Self-Hosted",
            baseUrl: "https://code.example.test",
          }
        : null,
    );
    assert.deepStrictEqual(hosts, ["code.example.test"]);
  }),
);

it.effect("asks for no credential when the identity resolver left the base URL empty", () =>
  Effect.gen(function* () {
    const hosts: Array<string> = [];
    const discovery = yield* makeDiscovery((host) => {
      hosts.push(host);
      return signedIn(host);
    });
    if (discovery.type !== "managed-cli") return assert.fail("expected a managed CLI");
    assert.strictEqual(
      yield* discovery.refineUnknownRemote({ cwd: "/repo", context: unknownContext("") }),
      null,
    );
    assert.deepStrictEqual(hosts, []);
  }),
);

it.effect("claims a remote through the shared gh login, not a request's pinned credential", () =>
  Effect.gen(function* () {
    const spawned: Array<string> = [];
    const discovery = yield* GitHubProviderDiscovery.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(GitHubRest.GitHubRest)({}),
          GitHubCredentials.layer.pipe(Layer.provide(NodeCrypto.layer)),
        ).pipe(
          Layer.provideMerge(
            TestSourceControlHost.layer({
              process: {
                run: ({ command, args }) => {
                  spawned.push([command, ...args].join(" "));
                  return Effect.succeed(
                    TestSourceControlHost.processOutput(
                      command === "gh" && args[0] === "auth" && args[1] === "token"
                        ? "gh-token\n"
                        : "",
                    ),
                  );
                },
              },
            }),
          ),
        ),
      ),
      Effect.provideService(HostProcess.Environment, {}),
    );
    if (discovery.type !== "managed-cli") return assert.fail("expected a managed CLI");
    const provider = yield* discovery
      .refineUnknownRemote({ cwd: "/repo", context: unknownContext("https://code.example.test") })
      .pipe(
        Effect.provideService(GitHubRequestPolicy.PinnedGitHubCredential, {
          host: "github.com",
          token: Redacted.make("pinned-token"),
          credentialFingerprint: "github.com:pinned",
        }),
      );
    assert.strictEqual(provider?.kind, SourceControlProviderKind.make("github"));
    assert.isTrue(spawned.some((command) => command.startsWith("gh auth token")));
  }),
);
