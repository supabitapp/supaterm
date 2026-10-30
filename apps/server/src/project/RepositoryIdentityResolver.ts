import type { RepositoryIdentity, SourceControlProviderError } from "@supaterm/contracts";
import { repositoryPathFromRemoteUrl } from "@supaterm/source-control-core/server/SourceControlProvider";
import {
  GH_RESOLVED_CONFIG_ARGS,
  parseGhResolvedRemotes,
  parseGitRemoteFetchUrls,
} from "@supaterm/shared/git";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import { explicitBareRepositoryEnv } from "../vcs/VcsProcess.ts";
import * as HostProcess from "@supaterm/shared/HostProcess";

const DEFAULT_REPOSITORY_IDENTITY_CACHE_CAPACITY = 512;
const DEFAULT_POSITIVE_CACHE_TTL = Duration.minutes(15);
const DEFAULT_NEGATIVE_CACHE_TTL = Duration.minutes(1);

export interface RepositoryIdentityResolverOptions {
  readonly cacheCapacity?: number;
  readonly positiveCacheTtl?: Duration.Input;
  readonly negativeCacheTtl?: Duration.Input;
  readonly refine?: (
    identity: RepositoryIdentity,
  ) => Effect.Effect<RepositoryIdentity, SourceControlProviderError>;
}

export class RepositoryIdentityResolver extends Context.Service<
  RepositoryIdentityResolver,
  {
    readonly resolve: (
      cwd: string,
      options?: { readonly refresh?: boolean },
    ) => Effect.Effect<RepositoryIdentity | null>;
  }
>()("supaterm/project/RepositoryIdentityResolver") {}

function isLocalRemoteUrl(url: string): boolean {
  if (/^file:/i.test(url)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return false;
  if (/^[a-z]:[\\/]/i.test(url)) return true;

  const colonIndex = url.indexOf(":");
  const slashIndex = url.search(/[\\/]/);
  return colonIndex === -1 || (slashIndex !== -1 && slashIndex < colonIndex);
}

function pickPrimaryRemote(
  remotes: ReadonlyMap<string, string>,
): { readonly remoteName: string; readonly remoteUrl: string } | null {
  for (const preferredRemoteName of ["upstream", "origin"] as const) {
    const remoteUrl = remotes.get(preferredRemoteName);
    if (remoteUrl) {
      return { remoteName: preferredRemoteName, remoteUrl };
    }
  }

  const [remoteName, remoteUrl] =
    [...remotes.entries()].toSorted(([left], [right]) => left.localeCompare(right))[0] ?? [];
  return remoteName && remoteUrl ? { remoteName, remoteUrl } : null;
}

function repositoryPathOf(canonicalKey: string, remoteUrl: string): string {
  const canonicalPath = canonicalKey.split("/").slice(1).join("/");
  const displayPath = repositoryPathFromRemoteUrl(remoteUrl);
  return displayPath?.toLowerCase() === canonicalPath ? displayPath : canonicalPath;
}

function buildRepositoryOrigin(
  originUrl: string | undefined,
  canonicalKey: string,
): RepositoryIdentity["origin"] {
  if (!originUrl) return undefined;
  const originKey = sourceControlDefinitions.repositoryKeyFromRemote(originUrl);
  if (originKey === canonicalKey) return undefined;
  const displayName = repositoryPathOf(originKey, originUrl);
  return { canonicalKey: originKey, remoteUrl: originUrl, ...(displayName ? { displayName } : {}) };
}

function buildRepositoryIdentity(input: {
  readonly remoteName: string;
  readonly remoteUrl: string;
  readonly originUrl: string | undefined;
  readonly rootPath: string;
}): RepositoryIdentity {
  const canonicalKey = sourceControlDefinitions.repositoryKeyFromRemote(input.remoteUrl);
  const sourceControlProvider = sourceControlDefinitions.recognizeRemote(input.remoteUrl);
  const repositoryPath = repositoryPathOf(canonicalKey, input.remoteUrl);
  const repositoryPathSegments = repositoryPath.split("/").filter((segment) => segment.length > 0);
  const [owner] = repositoryPathSegments;
  const repositoryName = repositoryPathSegments.at(-1);
  const origin = buildRepositoryOrigin(input.originUrl, canonicalKey);

  return {
    canonicalKey,
    locator: {
      source: "git-remote",
      remoteName: input.remoteName,
      remoteUrl: input.remoteUrl,
    },
    rootPath: input.rootPath,
    ...(repositoryPath ? { displayName: repositoryPath } : {}),
    ...(sourceControlProvider ? { provider: sourceControlProvider.kind } : {}),
    ...(owner ? { owner } : {}),
    ...(repositoryName ? { name: repositoryName } : {}),
    ...(origin ? { origin } : {}),
  };
}

class RepositoryIdentityCacheKey extends Data.Class<{
  readonly rootPath: string;
  readonly isBare: boolean;
}> {}

const resolveRepositoryIdentityCacheKey = Effect.fn("RepositoryIdentityResolver.resolveCacheKey")(
  function* (cwd: string) {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const env = explicitBareRepositoryEnv(process.env, yield* HostProcess.Platform);

    const topLevelResult = yield* processRunner
      .run({
        command: "git",
        args: ["-C", cwd, "rev-parse", "--show-toplevel"],
        env,
        timeoutBehavior: "timedOutResult",
      })
      .pipe(Effect.option);
    if (topLevelResult._tag === "None" || topLevelResult.value.timedOut) {
      return null;
    }
    if (topLevelResult.value.code === 0) {
      const rootPath = topLevelResult.value.stdout.trim();
      return rootPath.length > 0
        ? new RepositoryIdentityCacheKey({ rootPath, isBare: false })
        : null;
    }

    // Explicit Git directories preserve safe.bareRepository=explicit for both layouts.
    for (const gitDir of [".", ".git"]) {
      const bareResult = yield* processRunner
        .run({
          command: "git",
          args: [
            "-C",
            cwd,
            `--git-dir=${gitDir}`,
            "rev-parse",
            "--is-bare-repository",
            "--absolute-git-dir",
          ],
          env,
          timeoutBehavior: "timedOutResult",
        })
        .pipe(Effect.option);
      if (bareResult._tag === "None" || bareResult.value.timedOut) return null;
      if (bareResult.value.code !== 0) continue;

      const [isBare, rootPath = ""] = bareResult.value.stdout
        .split("\n")
        .map((line) => line.trim());
      // A checkout's .git directory contains remotes but is not a project root.
      return isBare === "true" && rootPath.length > 0
        ? new RepositoryIdentityCacheKey({ rootPath, isBare: true })
        : null;
    }
    return null;
  },
);

/** The remote `gh repo set-default` made the base, where this checkout's pull requests go. */
const readGhBaseRemote = Effect.fn("RepositoryIdentityResolver.readGhBaseRemote")(function* (
  cacheKey: string,
  remotes: ReadonlyMap<string, string>,
) {
  if (remotes.size < 2) return null;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const result = yield* processRunner
    .run({
      command: "git",
      args: ["-C", cacheKey, ...GH_RESOLVED_CONFIG_ARGS],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(Effect.option);
  if (result._tag === "None" || result.value.code !== 0) return null;
  const [mark, ...others] = parseGhResolvedRemotes(result.value.stdout).filter(({ remoteName }) =>
    remotes.has(remoteName),
  );
  if (mark?.resolution !== "base" || others.length > 0) return null;
  const remoteUrl = remotes.get(mark.remoteName);
  return remoteUrl === undefined ? null : { remoteName: mark.remoteName, remoteUrl };
});

const resolveRepositoryIdentityFromCacheKey = Effect.fn(
  "RepositoryIdentityResolver.resolveFromCacheKey",
)(function* (
  cacheKey: RepositoryIdentityCacheKey,
): Effect.fn.Return<RepositoryIdentity | null, never, ProcessRunner.ProcessRunner> {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const remoteResult = yield* processRunner
    .run({
      command: "git",
      args: ["-C", cacheKey.rootPath, ...(cacheKey.isBare ? ["--git-dir=."] : []), "remote", "-v"],
      env: explicitBareRepositoryEnv(process.env, yield* HostProcess.Platform),
      timeoutBehavior: "timedOutResult",
    })
    .pipe(Effect.option);
  if (remoteResult._tag === "None" || remoteResult.value.code !== 0) {
    return null;
  }

  const remotes = new Map(
    [...parseGitRemoteFetchUrls(remoteResult.value.stdout)].filter(
      ([, url]) => !isLocalRemoteUrl(url),
    ),
  );
  const remote =
    (yield* readGhBaseRemote(cacheKey.rootPath, remotes)) ?? pickPrimaryRemote(remotes);
  return remote
    ? buildRepositoryIdentity({
        ...remote,
        originUrl: remotes.get("origin"),
        rootPath: cacheKey.rootPath,
      })
    : null;
});

export const make = Effect.fn("RepositoryIdentityResolver.make")(function* (
  options: RepositoryIdentityResolverOptions = {},
) {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const cacheCapacity = options.cacheCapacity ?? DEFAULT_REPOSITORY_IDENTITY_CACHE_CAPACITY;
  const refine = options.refine ?? Effect.succeed;
  const timeToLive = (exit: Exit.Exit<unknown>) =>
    Exit.match(exit, {
      onSuccess: (value) =>
        value === null
          ? (options.negativeCacheTtl ?? DEFAULT_NEGATIVE_CACHE_TTL)
          : (options.positiveCacheTtl ?? DEFAULT_POSITIVE_CACHE_TTL),
      onFailure: () => Duration.zero,
    });

  const repositoryRootCache = yield* Cache.makeWith<string, RepositoryIdentityCacheKey | null>(
    (cwd) =>
      resolveRepositoryIdentityCacheKey(cwd).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
      ),
    { capacity: cacheCapacity, timeToLive },
  );

  const repositoryIdentityCache = yield* Cache.makeWith<
    RepositoryIdentityCacheKey,
    RepositoryIdentity | null
  >(
    (cacheKey) =>
      resolveRepositoryIdentityFromCacheKey(cacheKey).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
        Effect.filterOrElse(
          (identity): identity is null => identity === null,
          (identity) => refine(identity).pipe(Effect.orElseSucceed(() => identity)),
        ),
      ),
    { capacity: cacheCapacity, timeToLive },
  );

  const resolve: RepositoryIdentityResolver["Service"]["resolve"] = Effect.fnUntraced(
    function* (cwd, options) {
      if (options?.refresh) yield* Cache.invalidate(repositoryRootCache, cwd);
      const cacheKey = yield* Cache.get(repositoryRootCache, cwd);
      if (cacheKey === null) return null;
      if (options?.refresh) yield* Cache.invalidate(repositoryIdentityCache, cacheKey);
      return yield* Cache.get(repositoryIdentityCache, cacheKey);
    },
  );

  return RepositoryIdentityResolver.of({ resolve });
});

export const layer = Layer.effect(RepositoryIdentityResolver, make()).pipe(
  Layer.provide(ProcessRunner.layer),
);
