import { SourceControlProviderKind } from "@supaterm/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as PubSub from "effect/PubSub";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";
import {
  DEFAULT_SERVER_SETTINGS,
  VcsProcessSpawnError,
  VcsProcessTimeoutError,
} from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";

import * as ServerSettings from "../serverSettings.ts";
import * as ServerConfig from "../config.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as AzureDevOpsCli from "@supaterm/source-control-azure-devops/server/AzureDevOpsCli";
import * as AzureDevOpsPullRequestCli from "@supaterm/source-control-azure-devops/server/AzureDevOpsPullRequestCli";
import * as BitbucketApi from "@supaterm/source-control-bitbucket/server/BitbucketApi";
import * as BitbucketPullRequestApi from "@supaterm/source-control-bitbucket/server/BitbucketPullRequestApi";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as GitHubRest from "@supaterm/source-control-github/server/GitHubRest";
import * as GitHubRequestPolicy from "@supaterm/source-control-github/server/GitHubRequestPolicy";
import * as GitHubPullRequestApi from "@supaterm/source-control-github/server/GitHubPullRequestApi";
import * as GitHubCredentials from "@supaterm/source-control-github/server/GitHubCredentials";
import * as GitLabCli from "@supaterm/source-control-gitlab/server/GitLabCli";
import * as GitLabPullRequestCli from "@supaterm/source-control-gitlab/server/GitLabPullRequestCli";
import * as ForgejoCli from "@supaterm/source-control-forgejo/server/ForgejoCli";
import * as GitCafeApi from "@supaterm/source-control-gitcafe/server/GitCafeApi";
import * as GitCafeCredentials from "@supaterm/source-control-gitcafe/server/GitCafeCredentials";
import * as BuiltInDriversTestkit from "./builtInDrivers.testkit.ts";
import * as SourceControlProviderRegistry from "./SourceControlProviderRegistry.ts";
import * as ServerSourceControlHost from "./ServerSourceControlHost.ts";

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const processOutput = (
  stdout: string,
  options?: {
    readonly stderr?: string;
    readonly exitCode?: ChildProcessSpawner.ExitCode;
  },
): VcsProcess.VcsProcessOutput => ({
  exitCode: options?.exitCode ?? ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: options?.stderr ?? "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const credentialsLayer = (get: GitHubCredentials.GitHubCredentials["Service"]["get"]) =>
  Layer.mock(GitHubCredentials.GitHubCredentials)({ get, invalidateAll: Effect.void });

const signedInCredential = (host: string) =>
  Effect.succeed({
    host,
    token: Redacted.make("token"),
    source: "gh" as const,
    fingerprint: `${host}:fingerprint`,
  });

function makeRegistry(input: {
  readonly remotes: ReadonlyArray<{
    readonly name: string;
    readonly url: string;
  }>;
  readonly process?: Partial<VcsProcess.VcsProcess["Service"]>;
  readonly githubApi?: Partial<GitHubRest.GitHubRest["Service"]>;
  readonly githubCredentials?: typeof GitHubCredentials.layer;
  readonly gitlab?: Partial<GitLabCli.GitLabCli["Service"]>;
  readonly forgejo?: Partial<ForgejoCli.ForgejoCli["Service"]>;
  readonly settings?: Partial<ServerSettings.ServerSettingsService["Service"]>;
  readonly resolve?: VcsDriverRegistry.VcsDriverRegistry["Service"]["resolve"];
}) {
  const driver = {
    listRemotes: () =>
      Effect.succeed({
        remotes: input.remotes.map((remote) => ({
          ...remote,
          pushUrl: Option.none(),
          isPrimary: remote.name === "origin",
        })),
        freshness: {
          source: "live-local" as const,
          observedAt: TEST_EPOCH,
          expiresAt: Option.none(),
        },
      }),
  } satisfies Partial<VcsDriver.VcsDriver["Service"]>;

  const layerRegistry = Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
    get: () => Effect.succeed(driver as unknown as VcsDriver.VcsDriver["Service"]),
    resolve:
      input.resolve ??
      (() =>
        Effect.succeed({
          kind: "git",
          repository: {
            kind: "git",
            rootPath: "/repo",
            metadataPath: null,
            freshness: {
              source: "live-local" as const,
              observedAt: TEST_EPOCH,
              expiresAt: Option.none(),
            },
          },
          driver: driver as unknown as VcsDriver.VcsDriver["Service"],
        })),
  });

  const layerProcess = Layer.mock(VcsProcess.VcsProcess)({
    run: () => Effect.succeed(processOutput("")),
    ...input.process,
  });
  const layerHost = ServerSourceControlHost.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerProcess,
        layerRegistry,
        ServerSettings.ServerSettingsService.layerTest(),
        Layer.mock(GitVcsDriver.GitVcsDriver)({}),
      ),
    ),
  );

  return SourceControlProviderRegistry.make.pipe(
    Effect.provide(
      BuiltInDriversTestkit.layerOverHostServices.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            layerRegistry,
            layerProcess,
            layerHost,
            Layer.mock(AzureDevOpsCli.AzureDevOpsCli)({}),
            Layer.mock(AzureDevOpsPullRequestCli.AzureDevOpsPullRequestCli)({}),
            Layer.mock(BitbucketApi.BitbucketApi)({
              probeAuth: Effect.succeed({
                status: "unknown",
                account: Option.none(),
                host: Option.none(),
                detail: Option.none(),
              }),
            }),
            Layer.mock(BitbucketPullRequestApi.BitbucketPullRequestApi)({}),
            input.settings
              ? Layer.mock(ServerSettings.ServerSettingsService)(input.settings)
              : ServerSettings.ServerSettingsService.layerTest(),
            Layer.mock(GitHubPullRequestApi.GitHubPullRequestApi)({}),
            // The GitHub provider's GraphQL reads go through these; no test here makes one.
            Layer.mock(GitHubRequestPolicy.GitHubRequestPolicy)({}),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die(new Error("Unexpected GitHub GraphQL read"))),
            ),
            Layer.mock(GitHubRest.GitHubRest)(input.githubApi ?? {}),
            (
              input.githubCredentials ??
              credentialsLayer((host) =>
                Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host })),
              )
            ).pipe(Layer.provide(layerHost)),
            Layer.mock(GitVcsDriver.GitVcsDriver)({}),
            Layer.mock(GitLabCli.GitLabCli)(input.gitlab ?? {}),
            Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({}),
            Layer.mock(ForgejoCli.ForgejoCli)({
              listLogins: () => Effect.succeed([]),
              ...input.forgejo,
            }),
            Layer.mock(GitCafeApi.GitCafeApi)({}),
            Layer.mock(GitCafeCredentials.GitCafeCredentials)({
              cliEnv: () => Effect.succeed({}),
            }),
            ServerConfig.layerTest(process.cwd(), {
              prefix: "supaterm-source-control-registry-test-",
            }).pipe(Layer.provide(NodeServices.layer)),
          ).pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                NodeServices.layer,
                layerProcess,
                ServerSettings.ServerSettingsService.layerTest(),
                Layer.succeed(HostProcess.Environment, {}),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

it.effect("routes authenticated self-hosted GitLab remotes without relying on host naming", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "https://self-hosted.example.test/group/project.git" }],
      process: {
        run: () =>
          Effect.succeed(
            processOutput(
              `gitlab.com
  x gitlab.com: API call failed: 401 Unauthorized
  ! No token found
self-hosted.example.test
  ✓ Logged in to self-hosted.example.test as gitlab-user
  ✓ Token found: ******
`,
              { exitCode: ChildProcessSpawner.ExitCode(1) },
            ),
          ),
      },
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "gitlab");
  }),
);

it.effect("refines the caller-selected remote instead of choosing another configured remote", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@github.com:fork/project.git" }],
      process: {
        run: () =>
          Effect.succeed(
            processOutput(`self-hosted.example.test
  ✓ Logged in to self-hosted.example.test as gitlab-user
`),
          ),
      },
    });

    const handle = yield* registry.resolveHandle({
      cwd: "/repo",
      context: {
        provider: {
          kind: SourceControlProviderKind.make("unknown"),
          name: "self-hosted.example.test",
          baseUrl: "https://self-hosted.example.test",
        },
        remoteName: "upstream",
        remoteUrl: "https://self-hosted.example.test/group/project.git",
      },
    });

    assert.strictEqual(handle.context?.provider.kind, "gitlab");
    assert.strictEqual(handle.context?.remoteName, "upstream");
  }),
);

it.effect("routes authenticated self-hosted GitLab remotes on non-standard ports", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "https://self-hosted.example.test:8443/group/project.git" }],
      process: {
        run: () =>
          Effect.succeed(
            processOutput(
              `self-hosted.example.test:8443
  ✓ Logged in to self-hosted.example.test:8443 as gitlab-user
  ✓ Token found: ******
`,
            ),
          ),
      },
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "gitlab");
  }),
);

it.effect("falls back to a non-origin remote when origin is not configured", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "upstream", url: "https://dev.azure.com/acme/project/_git/repo" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "azure-devops");
  }),
);

it.effect(
  "routes linked subjects by URL independently of the checkout and skips unsupported links",
  () =>
    Effect.gen(function* () {
      const registry = yield* makeRegistry({
        remotes: [{ name: "origin", url: "https://github.com/unrelated/checkout.git" }],
        githubApi: {
          rest: () =>
            Effect.succeed({
              status: 200,
              headers: {},
              body: JSON.stringify({ title: "GitHub issue", body: null }),
              truncated: false,
              invalidUtf8: false,
            }),
        },
        gitlab: {
          execute: () =>
            Effect.succeed(
              processOutput(JSON.stringify({ title: "GitLab MR", description: "Nested project" })),
            ),
        },
      });
      for (const [url, expected] of [
        ["https://github.com/team/project/issues/1", { title: "GitHub issue", body: null }],
        [
          "https://gitlab.com/team/sub/project/-/merge_requests/2",
          { title: "GitLab MR", body: "Nested project" },
        ],
      ] as const) {
        const lookup = registry.resolveLink({ cwd: "/unrelated", url: new URL(url) });
        assert.ok(lookup);
        assert.deepStrictEqual(yield* lookup, expected);
      }
      for (const url of [
        "https://example.test/team/project/issues/1",
        "https://github.attacker.test/team/project/issues/1",
        "https://gitlab.attacker.test/team/project/-/issues/1",
        "https://github.com/team/project",
        "https://codeberg.org/team/project/issues/1",
        "https://bitbucket.org/team/project/pull-requests/1",
        "https://dev.azure.com/org/project/_git/repo/pullrequest/1",
        "http://github.com/team/project/issues/1",
        "https://user:secret@github.com/team/project/issues/1",
      ]) {
        assert.strictEqual(
          registry.resolveLink({ cwd: "/unrelated", url: new URL(url) }),
          undefined,
        );
      }
    }).pipe(Effect.scoped),
);

it.effect.each([
  { name: "a credential", credential: "found", expected: "github" },

  { name: "a host turned off in Settings", credential: "disabled", expected: "github" },
  { name: "no credential", credential: "missing", expected: "unknown" },
] as const)("resolves custom-host remotes with $name", (scenario) =>
  Effect.gen(function* () {
    const hosts: Array<string> = [];
    const commands: Array<string> = [];
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@code.example.test:team/project.git" }],
      process: {
        run: ({ command }) => {
          commands.push(command);
          return Effect.succeed(processOutput(""));
        },
      },
      githubCredentials: credentialsLayer((host) => {
        hosts.push(host);
        return scenario.credential === "found"
          ? signedInCredential(host)
          : scenario.credential === "disabled"
            ? Effect.fail(new GitHubCredentials.GitHubHostDisabledError({ host }))
            : Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host }));
      }),
    });
    const handle = yield* registry.resolveHandle({ cwd: "/repo" });
    assert.strictEqual(handle.provider.kind, SourceControlProviderKind.make(scenario.expected));
    assert.strictEqual(handle.context?.provider.baseUrl, "https://code.example.test");
    assert.deepStrictEqual(hosts, ["code.example.test"]);

    assert.notInclude(commands, "gh");
  }),
);

it.effect("skips GitHub discovery for the identity resolver's empty base URL", () =>
  Effect.gen(function* () {
    const hosts: string[] = [];
    const remoteUrl = "git@githubenterprise.dev.example.com:team/workspace.git";
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: remoteUrl }],
      githubCredentials: credentialsLayer((host) => {
        hosts.push(host);
        return signedInCredential(host);
      }),
    });
    const context = {
      provider: { kind: SourceControlProviderKind.make("unknown"), name: "Unknown", baseUrl: "" },
      remoteName: "origin",
      remoteUrl,
    };
    const unresolved = yield* registry.resolveHandle({ cwd: "/repo", context });
    assert.deepStrictEqual(unresolved.context, context);
    assert.deepStrictEqual(hosts, []);

    const resolved = yield* registry.resolveHandle({ cwd: "/repo" });
    assert.strictEqual(resolved.provider.kind, "github");
    assert.strictEqual(
      resolved.context?.provider.baseUrl,
      "https://githubenterprise.dev.example.com",
    );
    assert.deepStrictEqual(hosts, ["githubenterprise.dev.example.com"]);
  }),
);

const notFound = (command: string, cwd: string) =>
  new VcsProcessSpawnError({
    operation: "test",
    command,
    cwd,
    cause: PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" }),
  });

const resolveUnknown = (
  registry: SourceControlProviderRegistry.SourceControlProviderRegistry["Service"],
  repository: string,
) =>
  registry.resolveHandle({
    cwd: `/${repository}`,
    context: {
      provider: {
        kind: SourceControlProviderKind.make("unknown"),
        name: "git.example.internal",
        baseUrl: "https://git.example.internal",
      },
      remoteName: "origin",
      remoteUrl: `git@Git.Example.Internal:team/${repository}.git`,
    },
  });

it.effect("refines an unrecognized remote once per TTL however often it is resolved", () =>
  Effect.gen(function* () {
    const commands: Array<string> = [];
    const hosts: Array<string> = [];
    const remoteUrl = "git@github-work:team/project.git";
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: remoteUrl }],
      process: {
        run: ({ command, cwd }) => {
          commands.push(command);
          return Effect.fail(notFound(command, cwd));
        },
      },
      githubCredentials: credentialsLayer((host) => {
        hosts.push(host);
        return Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host }));
      }),
    });
    const context = {
      provider: {
        kind: SourceControlProviderKind.make("unknown"),
        name: "github-work",
        baseUrl: "https://github-work",
      },
      remoteName: "origin",
      remoteUrl,
    };
    const resolveAll = Effect.gen(function* () {
      yield* registry.resolveHandle({ cwd: "/repo", context });
      yield* registry.resolveHandle({ cwd: "/repo", context });
      const detected = yield* registry.resolveHandle({ cwd: "/repo" });
      assert.deepStrictEqual(detected.context, context);
    });

    yield* resolveAll;
    const probes = commands.length;
    assert.isAbove(probes, 0);
    assert.deepStrictEqual(hosts, ["github-work"]);

    yield* resolveAll;
    assert.strictEqual(commands.length, probes);
    assert.deepStrictEqual(hosts, ["github-work"]);

    yield* TestClock.adjust(Duration.minutes(5));
    yield* registry.resolveHandle({ cwd: "/repo", context });
    assert.strictEqual(commands.length, probes * 2);
    assert.deepStrictEqual(hosts, ["github-work", "github-work"]);
  }),
);

function makeRegistryWithGhLogin(isSignedIn: () => boolean) {
  let spawns = 0;
  return makeRegistry({
    remotes: [{ name: "origin", url: "git@code.example.test:team/project.git" }],
    githubCredentials: GitHubCredentials.layer,
    process: {
      run: ({ command, args, cwd }) => {
        spawns++;
        if (command !== "gh") return Effect.fail(notFound(command, cwd));
        const isTokenRequest = command === "gh" && args[0] === "auth" && args[1] === "token";
        return Effect.succeed(processOutput(isTokenRequest && isSignedIn() ? "gh-token\n" : ""));
      },
    },
  }).pipe(Effect.map((registry) => ({ registry, spawns: () => spawns })));
}

it.effect(
  "applies a fresh gh sign-in on the next discovery instead of waiting out the caches",
  () =>
    Effect.gen(function* () {
      let signedIn = false;
      const { registry } = yield* makeRegistryWithGhLogin(() => signedIn);

      assert.strictEqual(
        (yield* registry.resolveHandle({ cwd: "/repo" })).provider.kind,
        "unknown",
      );
      signedIn = true;
      assert.strictEqual(
        (yield* registry.resolveHandle({ cwd: "/repo" })).provider.kind,
        "unknown",
      );

      yield* registry.discover;
      assert.strictEqual((yield* registry.resolveHandle({ cwd: "/repo" })).provider.kind, "github");
    }),
);

it.effect("keeps a request's pinned GitHub credential out of the shared refinement", () =>
  Effect.gen(function* () {
    const { registry, spawns } = yield* makeRegistryWithGhLogin(() => true);
    const context = {
      provider: {
        kind: SourceControlProviderKind.make("unknown"),
        name: "code.example.test",
        baseUrl: "https://code.example.test",
      },
      remoteName: "origin",
      remoteUrl: "git@code.example.test:team/project.git",
    };

    const pinned = yield* registry.resolveHandle({ cwd: "/repo", context }).pipe(
      Effect.provideService(GitHubRequestPolicy.PinnedGitHubCredential, {
        host: "github.com",
        token: Redacted.make("pinned-token"),
        credentialFingerprint: "github.com:pinned",
      }),
    );
    assert.strictEqual(pinned.provider.kind, "github");
    const spawnsAfterPinned = spawns();

    const unpinned = yield* registry.resolveHandle({ cwd: "/repo", context });
    assert.strictEqual(unpinned.provider.kind, "github");
    assert.strictEqual(spawns(), spawnsAfterPinned);
  }),
);

it.effect("asks once for every checkout of a server no integration claims", () =>
  Effect.gen(function* () {
    const asked: Array<string> = [];
    const release = yield* Deferred.make<void>();
    const registry = yield* makeRegistry({
      remotes: [],
      process: {
        run: ({ command, args, cwd }) => {
          asked.push([command, ...args].join(" "));
          return Deferred.await(release).pipe(Effect.andThen(Effect.fail(notFound(command, cwd))));
        },
      },
      githubCredentials: credentialsLayer((host) => {
        asked.push(`credential ${host}`);
        return Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host }));
      }),
      forgejo: {
        listLogins: ({ command = "tea", cwd }) => {
          asked.push(command);
          const cause = notFound(command, cwd);
          return Effect.fail(new ForgejoCli.ForgejoCliError({ command, cwd, detail: "", cause }));
        },
      },
    });

    const started = yield* Effect.forEach(["a", "b", "c"], () => Deferred.make<void>());
    const callers = yield* Effect.forEach(
      ["a", "b", "c"],
      (repository, index) =>
        Deferred.succeed(started[index]!, undefined).pipe(
          Effect.andThen(resolveUnknown(registry, repository)),
        ),
      { concurrency: "unbounded" },
    ).pipe(Effect.forkChild);
    yield* Effect.forEach(started, Deferred.await);
    yield* Deferred.succeed(release, undefined);
    const handles = yield* Fiber.join(callers);
    yield* resolveUnknown(registry, "d");
    assert.deepStrictEqual(
      handles.map((handle) => handle.provider.kind),
      ["unknown", "unknown", "unknown"],
    );
    const once = asked.slice();
    assert.sameMembers(once, [
      "credential git.example.internal",
      "glab auth status --hostname Git.Example.Internal",
      "fj",
      "tea",
    ]);

    yield* TestClock.adjust("5 minutes");
    yield* resolveUnknown(registry, "a");
    assert.deepStrictEqual(asked, [...once, ...once]);
  }),
);

it.effect("asks again after a check that could not answer", () =>
  Effect.gen(function* () {
    let asks = 0;
    const registry = yield* makeRegistry({
      remotes: [],
      process: {
        run: ({ command, cwd }) => {
          asks += 1;
          return Effect.fail(
            new VcsProcessTimeoutError({ operation: "test", command, cwd, timeoutMs: 1 }),
          );
        },
      },
    });
    yield* resolveUnknown(registry, "a");
    yield* resolveUnknown(registry, "b");
    assert.strictEqual(asks, 2);
  }),
);

it.effect("asks again once Settings change", () =>
  Effect.gen(function* () {
    const changes = yield* PubSub.unbounded<typeof DEFAULT_SERVER_SETTINGS>();
    const handled = yield* Deferred.make<void>();
    let signedIn = false;
    const registry = yield* makeRegistry({
      remotes: [],
      settings: {
        subscribeChanges: PubSub.subscribe(changes).pipe(
          Effect.map((subscription) =>
            Stream.fromSubscription(subscription).pipe(
              Stream.flatMap((settings) =>
                Stream.concat(
                  Stream.make(settings),
                  Stream.fromEffectDrain(Deferred.succeed(handled, undefined)),
                ),
              ),
            ),
          ),
        ),
      },
      process: { run: ({ command, cwd }) => Effect.fail(notFound(command, cwd)) },
      githubCredentials: credentialsLayer((host) =>
        signedIn
          ? signedInCredential(host)
          : Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host })),
      ),
    });
    assert.strictEqual((yield* resolveUnknown(registry, "a")).provider.kind, "unknown");
    signedIn = true;
    assert.strictEqual((yield* resolveUnknown(registry, "b")).provider.kind, "unknown");

    yield* PubSub.publish(changes, DEFAULT_SERVER_SETTINGS);
    yield* Deferred.await(handled);
    assert.strictEqual((yield* resolveUnknown(registry, "c")).provider.kind, "github");
  }),
);
