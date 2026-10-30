import {
  SourceControlProviderKind,
  type PullRequestReviewCapabilities,
  type PullRequestReviewerCapabilities,
} from "@supaterm/contracts";
import {
  providerAuth,
  type SourceControlProviderDiscoverySpec,
} from "@supaterm/source-control-core/server/discovery";
import type { SourceControlDriverInstance } from "@supaterm/source-control-core/server/driver";
import type { PullRequestProviderApi } from "@supaterm/source-control-core/server/PullRequestProvider";
import type * as SourceControlProvider from "@supaterm/source-control-core/server/SourceControlProvider";
import * as Effect from "effect/Effect";

const FULL_REVIEW: PullRequestReviewCapabilities = {
  inlineComment: true,
  reply: true,
  resolve: true,
  verdicts: ["comment", "approve", "request-changes"],
};

const FULL_REVIEWERS: PullRequestReviewerCapabilities = { request: true, listCandidates: true };

const kindOf = (kind: string) => SourceControlProviderKind.make(kind);

export function fakePullRequestProvider(
  kind: string,
  overrides: Partial<PullRequestProviderApi> = {},
): PullRequestProviderApi {
  return {
    kind: kindOf(kind),
    capabilities: {
      diff: true,
      comment: true,
      actions: ["merge", "ready", "draft", "close", "reopen"],
      mergeMethods: ["merge"],
      search: true,
      reactions: true,
      review: FULL_REVIEW,
      reviewers: FULL_REVIEWERS,
      edit: { changeRequest: true, comment: true },
    },
    getViewer: () => Effect.succeed("bilal"),
    getViewerPermissions: () =>
      Effect.succeed({
        actions: ["merge", "ready", "draft", "close", "reopen"],
        comment: true,
        resolve: true,
        verdicts: ["comment", "approve", "request-changes"],
        requestReviewers: true,
      }),
    listChangeRequests: () => Effect.succeed({ items: [], truncated: false, continues: true }),
    getChangeRequest: () => Effect.die("unused"),
    getChangeRequestActivity: () => Effect.die("unused"),
    getDiff: () => Effect.die("unused"),
    runAction: () => Effect.void,
    updateChangeRequest: () => Effect.void,
    comment: () => Effect.void,
    updateComment: () => Effect.void,
    submitReview: () => Effect.void,
    replyToThread: () => Effect.void,
    setThreadResolution: () => Effect.void,
    setReaction: () => Effect.void,
    listReviewerCandidates: () => Effect.succeed({ candidates: [], truncated: false }),
    setReviewerRequest: () => Effect.void,
    ...overrides,
  };
}

type SourceControlProviderService = SourceControlProvider.SourceControlProvider["Service"];

const unexpected = (kind: string, operation: string) => () =>
  Effect.die(`Unexpected ${kind} ${operation} in a test that supplied none.`);

export function fakeSourceControlProvider(
  kind: string,
  overrides: Partial<SourceControlProviderService> = {},
): SourceControlProviderService {
  return {
    kind: kindOf(kind),
    listChangeRequests: unexpected(kind, "listChangeRequests"),
    getChangeRequest: unexpected(kind, "getChangeRequest"),
    createChangeRequest: unexpected(kind, "createChangeRequest"),
    getRepositoryCloneUrls: unexpected(kind, "getRepositoryCloneUrls"),
    createRepository: unexpected(kind, "createRepository"),
    getDefaultBranch: unexpected(kind, "getDefaultBranch"),
    checkoutChangeRequest: unexpected(kind, "checkoutChangeRequest"),
    ...overrides,
  };
}

export function fakeDiscovery(
  kind: string,
  overrides: Partial<Extract<SourceControlProviderDiscoverySpec, { readonly type: "api" }>> = {},
): SourceControlProviderDiscoverySpec {
  return {
    type: "api",
    kind: kindOf(kind),
    label: kind,
    installHint: `Install ${kind}.`,
    probeAuth: Effect.succeed(providerAuth({ status: "unknown" })),
    ...overrides,
  };
}

export interface FakeSourceControlDriverOptions {
  readonly sourceControl?: Partial<SourceControlProviderService>;

  readonly pullRequests?: Partial<PullRequestProviderApi> | null;
  readonly discovery?: SourceControlProviderDiscoverySpec;
  readonly fetchMedia?: SourceControlDriverInstance["fetchMedia"];
}

export function fakeSourceControlDriverInstance(
  kind: string,
  options: FakeSourceControlDriverOptions = {},
): SourceControlDriverInstance {
  return {
    sourceControl: fakeSourceControlProvider(kind, options.sourceControl),
    discovery: options.discovery ?? fakeDiscovery(kind),
    pullRequests:
      options.pullRequests === null ? null : fakePullRequestProvider(kind, options.pullRequests),
    ...(options.fetchMedia === undefined ? {} : { fetchMedia: options.fetchMedia }),
  };
}
