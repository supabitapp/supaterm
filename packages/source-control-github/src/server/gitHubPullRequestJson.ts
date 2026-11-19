import { trimOptionalString as trimmed } from "@supaterm/source-control-core/server/pullRequestUtils";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { GraphQL } from "effect/graphql";
import type {
  PullRequestStackMembership,
  PullRequestActor,
  PullRequestReferenceCandidate,
  PullRequestPreview,
  PullRequestCheck,
  PullRequestChecksState,
  PullRequestComment,
  PullRequestCommit,
  PullRequestFileViewedState,
  PullRequestLabel,
  PullRequestMergeCapabilities,
  PullRequestMergeMethod,
  PullRequestMergeQueueRemoval,
  PullRequestOmittedFileStat,
  PullRequestMergeability,
  PullRequestReaction,
  PullRequestReactionContent,
  PullRequestReviewCommentDraft,
  PullRequestReviewDecision,
  PullRequestReviewPosition,
  PullRequestReviewThread,
  PullRequestReviewVerdict,
  PullRequestReviewerCandidate,
  PullRequestReviewerKind,
  PullRequestLabelCandidate,
  PullRequestState,
} from "@supaterm/contracts";
import { quoteGitPatchPath } from "@supaterm/shared/gitPatchPath";
import { decodeJsonResult } from "@supaterm/shared/schemaJson";
import {
  dedupeChecks,
  rollupCheckStatuses,
} from "@supaterm/source-control-core/server/pullRequestChecks";
import type { ProviderChangeRequestSummary } from "@supaterm/source-control-core/server/PullRequestProvider";

import type * as GitHubSchema from "../../schema/github.graphql.ts";
import type {
  PullRequestSummaryRepositoryPullRequestPullRequest as SummarizedPullRequest,
  PullRequestWatchFingerprintRepositoryPullRequestPullRequest as WatchedPullRequest,
} from "./pullRequestBatches.graphql.ts";
import {
  PageInfo as ListingPageInfo,
  PullRequestList,
  PullRequestRow,
  PullRequestSearch,
} from "./pullRequestListings.graphql.ts";
import type { PullRequestActionSummary } from "./pullRequestMutations.graphql.ts";
import type {
  CheckContext,
  LabelCandidates,
  PullRequestActivity,
  PullRequestCommitStats,
  PullRequestCheckContexts,
  PullRequestCore,
  PullRequestFilesViewed,
  PullRequestFileStats,
  PullRequestHeads,
  PullRequestPreview as PullRequestPreviewQuery,
  PullRequestSubject,
  RepositoryAuthors,
  RepositoryLabels,
  RepositoryReferences,
  ReferenceCandidate,
  ReviewerCandidates,
  ViewerPermissions,
} from "./pullRequestReads.graphql.ts";
import type {
  ReactionGroup,
  ReviewDismissals,
  ReviewThreadComments,
  ReviewThreadPage,
  ReviewThreadPages,
  ReviewThreads,
  ThreadComment,
} from "./pullRequestReviews.graphql.ts";

interface ActorFields {
  readonly __typename?: string | undefined;
  readonly login?: string | null | undefined;
  readonly name?: string | null | undefined;
  readonly avatarUrl?: string | null | undefined;
}

interface ListItemFields {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author?: ActorFields | null | undefined;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly state?: string | null | undefined;
  readonly isDraft?: boolean | undefined;
  readonly mergeable?: string | null | undefined;
  readonly reviewDecision?: string | null | undefined;
  readonly additions?: number | undefined;
  readonly deletions?: number | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mergedAt?: string | null | undefined;
  readonly reviewRequests?: ReadonlyArray<ReviewRequestFields> | undefined;
  readonly latestReviews?: ReadonlyArray<LatestReviewFields> | undefined;
  readonly labels?: ReadonlyArray<LabelFields> | undefined;
  readonly statusCheckRollup?: ReadonlyArray<CheckFields> | null | undefined;
}

interface LabelFields {
  readonly name: string;
  readonly color?: string | null | undefined;
  readonly description?: string | null | undefined;
}

interface ReviewRequestFields {
  readonly login?: string | null | undefined;
  readonly slug?: string | null | undefined;
  readonly name?: string | null | undefined;
}

interface LatestReviewFields {
  readonly state?: string | null | undefined;
  readonly isMinimized?: boolean | undefined;
}

/**
 * A check as the rollup reports it, a check run and a commit status alike. A check run reports
 * `status` plus a `conclusion` once it has completed; a commit status a single `state`.
 */
interface CheckFields {
  readonly name?: string | null | undefined;
  readonly context?: string | null | undefined;
  readonly status?: string | null | undefined;
  readonly conclusion?: string | null | undefined;
  readonly state?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly detailsUrl?: string | null | undefined;
  readonly targetUrl?: string | null | undefined;
  /**
   * What tells two same-named checks apart, and which run of one is the newest. Empty for an
   * app-provided check run, which belongs to no workflow, and absent on a commit status.
   */
  readonly workflowName?: string | null | undefined;
  readonly startedAt?: string | null | undefined;
  readonly completedAt?: string | null | undefined;
  /** Branch protection requires this check; asked for on github.com only. */
  readonly isRequired?: boolean | null | undefined;
}

/** Where a connection carries on from, which is what every paged read follows. */
interface PageInfoFields {
  readonly hasNextPage?: boolean | undefined;
  readonly endCursor?: string | null | undefined;
}

function nodesOf<A>(
  connection: { readonly nodes?: ReadonlyArray<A | null> | null | undefined } | null | undefined,
): ReadonlyArray<A>;
function nodesOf<A>(
  connection: { readonly nodes?: ReadonlyArray<A | null> | null | undefined } | null | undefined,
) {
  return (connection?.nodes ?? []).flatMap((node) =>
    node === null ? [] : [node],
  ) satisfies ReadonlyArray<A>;
}

const REACTION_CONTENT_BY_GITHUB: Readonly<Record<string, PullRequestReactionContent>> = {
  THUMBS_UP: "thumbs-up",
  THUMBS_DOWN: "thumbs-down",
  LAUGH: "laugh",
  HOORAY: "hooray",
  CONFUSED: "confused",
  HEART: "heart",
  ROCKET: "rocket",
  EYES: "eyes",
};

const GITHUB_REACTION_BY_CONTENT: Readonly<
  Record<PullRequestReactionContent, GitHubSchema.ReactionContent>
> = {
  "thumbs-up": "THUMBS_UP",
  "thumbs-down": "THUMBS_DOWN",
  laugh: "LAUGH",
  hooray: "HOORAY",
  confused: "CONFUSED",
  heart: "HEART",
  rocket: "ROCKET",
  eyes: "EYES",
};

export function gitHubReactionContent(content: PullRequestReactionContent) {
  return GITHUB_REACTION_BY_CONTENT[content];
}

function toReactions(
  groups: ReadonlyArray<ReactionGroup> | null | undefined,
  viewer: string | null,
) {
  const normalizedViewer = viewer?.toLowerCase() ?? null;
  const reactions: PullRequestReaction[] = [];
  for (const group of groups ?? []) {
    const content = REACTION_CONTENT_BY_GITHUB[trimmed(group.content)?.toUpperCase() ?? ""];
    if (content === undefined) continue;
    const logins = nodesOf(group.reactors).flatMap((node) =>
      "login" in node ? (trimmed(node.login) ?? []) : [],
    );
    const count = Math.max(group.reactors.totalCount, logins.length);
    if (count <= 0) continue;
    const actors =
      normalizedViewer === null
        ? logins
        : logins.filter((login) => login.toLowerCase() !== normalizedViewer);
    reactions.push({ content, count, actors, viewerHasReacted: group.viewerHasReacted });
  }
  return reactions;
}

const RawWorkflowRunsSchema = Schema.Struct({
  workflow_runs: Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      name: Schema.optional(Schema.NullOr(Schema.String)),
      html_url: Schema.optional(Schema.NullOr(Schema.String)),
      status: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});

const RawPullRequestFileSchema = Schema.Struct({
  filename: Schema.String,
  status: Schema.optional(Schema.NullOr(Schema.String)),
  previous_filename: Schema.optional(Schema.NullOr(Schema.String)),
  patch: Schema.optional(Schema.NullOr(Schema.String)),
  additions: Schema.optional(Schema.NullOr(Schema.Int)),
  deletions: Schema.optional(Schema.NullOr(Schema.Int)),
});

/** Null for a number that names no pull request the viewer can see. */
export function toPullRequestPreview(result: PullRequestPreviewQuery.Result) {
  const pullRequest = result.repository?.pullRequest;
  if (pullRequest == null)
    return null satisfies Omit<PullRequestPreview, "projectId" | "repository"> | null;
  return {
    ...pullRequest,
    author: toActor(pullRequest.author),
    state: toState(pullRequest),
  } satisfies Omit<PullRequestPreview, "projectId" | "repository"> | null;
}

/**
 * The ceiling on `search`, which refuses anything larger with EXCESSIVE_PAGINATION (measured:
 * `first: 101` is an error, `first: 100` is not).
 */
export const PULL_REQUEST_SEARCH_MAX_ROWS = 100;

/** A row count a listing read may ask for. */
export function pageRows(rows: number): number;
export function pageRows(rows: number) {
  return Math.min(Math.max(Math.trunc(rows), 1), PULL_REQUEST_SEARCH_MAX_ROWS) satisfies number;
}

/** The pull request's own node id, or null where GitHub found none. */
export function toPullRequestNodeId(result: {
  readonly repository: { readonly pullRequest: { readonly id: string } | null } | null;
}) {
  return result.repository?.pullRequest?.id ?? null;
}

/**
 * True when the subject named is the pull request itself, or hangs off it — false for anything
 * else, including a subject or a pull request this host could not find.
 */
export function isSubjectOfPullRequest(result: PullRequestSubject.Result) {
  const expected = result.repository?.pullRequest?.id ?? null;
  const node = result.node;
  const actual =
    node === null
      ? null
      : node.__typename === "IssueComment"
        ? (node.pullRequest?.id ?? null)
        : node.__typename === "PullRequestReviewComment"
          ? node.reviewCommentPullRequest.id
          : node.__typename === "PullRequestReview"
            ? node.reviewPullRequest.id
            : node.id;
  return expected !== null && actual !== null && expected === actual;
}

const ReviewSubmissionSchema = Schema.Struct({
  event: Schema.Literals(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  body: Schema.String,
  comments: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      start_line: Schema.optional(Schema.Int),
      start_side: Schema.optional(Schema.Literals(["LEFT", "RIGHT"])),
      line: Schema.Int,
      side: Schema.Literals(["LEFT", "RIGHT"]),
      body: Schema.String,
    }),
  ),
});

const REVIEW_EVENTS: Record<PullRequestReviewVerdict, "COMMENT" | "APPROVE" | "REQUEST_CHANGES"> = {
  comment: "COMMENT",
  approve: "APPROVE",
  "request-changes": "REQUEST_CHANGES",
};

function gitHubReviewPosition(position: PullRequestReviewPosition) {
  switch (position.kind) {
    case "added":
      return { line: position.newLine, side: "RIGHT" } satisfies {
        readonly line: number;
        readonly side: "LEFT" | "RIGHT";
      };
    case "deleted":
      return { line: position.oldLine, side: "LEFT" } satisfies {
        readonly line: number;
        readonly side: "LEFT" | "RIGHT";
      };
    case "context":
      return (
        position.side === "left"
          ? { line: position.oldLine, side: "LEFT" }
          : { line: position.newLine, side: "RIGHT" }
      ) satisfies {
        readonly line: number;
        readonly side: "LEFT" | "RIGHT";
      };
  }
}

export function buildReviewSubmission(input: {
  readonly verdict: PullRequestReviewVerdict;
  readonly body: string;
  readonly comments: ReadonlyArray<PullRequestReviewCommentDraft>;
}) {
  return {
    event: REVIEW_EVENTS[input.verdict],
    body: input.body,
    comments: input.comments.map((comment) => {
      const end = gitHubReviewPosition(comment.position);
      const start =
        comment.startPosition === undefined ? null : gitHubReviewPosition(comment.startPosition);
      const ranged = start !== null && (start.line !== end.line || start.side !== end.side);
      return {
        path: comment.path,
        ...(ranged ? { start_line: start.line, start_side: start.side } : {}),
        ...end,
        body: comment.body,
      };
    }),
  } satisfies typeof ReviewSubmissionSchema.Type;
}

export interface GitHubPullRequestListItem {
  readonly stack?: PullRequestStackMembership;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: PullRequestActor | null;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly mergeability: PullRequestMergeability;
  readonly reviewDecision: PullRequestReviewDecision | null;
  readonly additions: number;
  readonly deletions: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reviewRequestLogins: ReadonlyArray<string>;
  readonly hasTeamReviewRequest: boolean;
  readonly labels: ReadonlyArray<PullRequestLabel>;
  readonly checksState: PullRequestChecksState | null;
}

export interface GitHubPullRequestDetail extends GitHubPullRequestListItem {
  readonly isCrossRepository?: boolean;
  readonly headRepositoryOwner: string | null;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headSha?: string | null;
  readonly body: string;
  readonly changedFiles: number;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly checks: ReadonlyArray<PullRequestCheck>;
  readonly autoMergeEnabled?: boolean;
  readonly autoMergeMethod?: PullRequestMergeMethod;
}

export interface GitHubWorkflowRunApproval {
  readonly id: number;
  readonly name: string;
  readonly url: string | null;
}

export interface GitHubPullRequestHead {
  readonly number: number;
  readonly headSha: string;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryOwner: string | null;
}

export interface GitHubPullRequestActivity {
  readonly author: PullRequestActor | null;
  readonly comments: ReadonlyArray<PullRequestComment>;
  readonly commits: ReadonlyArray<PullRequestCommit>;
  readonly truncated: boolean;
}

function nextCursorOf(pageInfo: PageInfoFields | null | undefined) {
  return pageInfo?.hasNextPage === true ? trimmed(pageInfo.endCursor) : null;
}

function toPullRequestViewerFields(
  raw:
    | {
        readonly viewerCanUpdate?: boolean | undefined;
        readonly viewerDidAuthor?: boolean | undefined;
      }
    | null
    | undefined,
) {
  return { canUpdate: raw?.viewerCanUpdate !== false, didAuthor: raw?.viewerDidAuthor === true };
}

function toActor(raw: ActorFields | null | undefined) {
  const login = trimmed(raw?.login);
  return login === null
    ? null
    : {
        login,
        name: trimmed(raw?.name),
        avatarUrl: trimmed(raw?.avatarUrl),
        ...(raw?.__typename === "Bot" ? { isBot: true } : {}),
      };
}

interface RequestedTeamFields {
  readonly combinedSlug?: string | null | undefined;
  readonly teamName?: string | null | undefined;
  readonly teamAvatarUrl?: string | null | undefined;
}

function toRequestedTeam(raw: object | null | undefined) {
  if (raw == null || !("combinedSlug" in raw)) return null;
  const team = raw as RequestedTeamFields;
  const login = trimmed(team.combinedSlug);
  return login === null
    ? null
    : { login, name: trimmed(team.teamName), avatarUrl: trimmed(team.teamAvatarUrl) };
}

function toCommitActor(raw: {
  readonly email?: string | null | undefined;
  readonly login?: string | null | undefined;
  readonly name?: string | null | undefined;
}) {
  const login = trimmed(raw.login) ?? trimmed(raw.name) ?? trimmed(raw.email);
  return login === null ? null : { login, name: trimmed(raw.name), avatarUrl: null };
}

function toGraphqlCommitActor(raw: {
  readonly name?: string | null | undefined;
  readonly avatarUrl?: string | null | undefined;
  readonly user?: { readonly login?: string | null | undefined } | null | undefined;
}) {
  const login = trimmed(raw.user?.login) ?? trimmed(raw.name);
  return login === null
    ? null
    : { login, name: trimmed(raw.name), avatarUrl: trimmed(raw.avatarUrl) };
}

function toState(raw: {
  readonly state?: string | null | undefined;
  readonly mergedAt?: string | null | undefined;
}) {
  if (trimmed(raw.mergedAt) !== null) return "merged";
  const state = raw.state?.trim().toUpperCase();
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return "open";
}

function toMergeability(value: string | null | undefined) {
  switch (value?.trim().toUpperCase()) {
    case "MERGEABLE":
      return "mergeable";
    case "CONFLICTING":
      return "conflicting";
    default:
      return "unknown";
  }
}

function toMergeMethod(value: string | null | undefined) {
  switch (value?.trim().toUpperCase()) {
    case "MERGE":
      return "merge";
    case "SQUASH":
      return "squash";
    case "REBASE":
      return "rebase";
    default:
      return undefined;
  }
}

export function toPullRequestActionSummary(raw: PullRequestActionSummary | null | undefined) {
  if (raw == null) return undefined satisfies ProviderChangeRequestSummary | undefined;
  const autoMergeMethod = toMergeMethod(raw.autoMergeRequest?.mergeMethod);
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    headBranch: raw.headRefName,
    baseBranch: raw.baseRefName,
    state: toState(raw),
    isDraft: raw.isDraft,
    updatedAt: raw.updatedAt,
    mergedAt: trimmed(raw.mergedAt),
    closedAt: trimmed(raw.closedAt),
    author: toActor(raw.author),
    headSha: raw.headRefOid,
    autoMergeEnabled: raw.autoMergeRequest !== null,
    ...(autoMergeMethod === undefined ? {} : { autoMergeMethod }),
  } satisfies ProviderChangeRequestSummary | undefined;
}

function toReviewDecisionWithReviews(
  value: string | null | undefined,
  reviews: ReadonlyArray<LatestReviewFields> | undefined,
) {
  const summarized = toReviewDecision(value);
  if (summarized === "approved" || summarized === "changes-requested") return summarized;
  const states = new Set(
    (reviews ?? [])
      .filter((review) => !review.isMinimized)
      .map((review) => review.state?.trim().toUpperCase() ?? ""),
  );
  if (states.has("CHANGES_REQUESTED")) return "changes-requested";
  if (summarized === null && states.has("APPROVED")) return "approved";
  return summarized;
}

function toReviewDecision(value: string | null | undefined) {
  switch (value?.trim().toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes-requested";
    case "REVIEW_REQUIRED":
      return "review-required";
    default:
      return null;
  }
}

function toLabels(raw: ReadonlyArray<LabelFields> | undefined) {
  return (raw ?? []).flatMap((label) => {
    const name = trimmed(label.name);
    return name === null
      ? []
      : [{ name, color: trimmed(label.color), description: trimmed(label.description) }];
  });
}

function toReviewRequestLogins(raw: ReadonlyArray<ReviewRequestFields> | undefined) {
  return (raw ?? []).flatMap((request) => {
    const login = trimmed(request.login);
    return login === null ? [] : [login];
  });
}

function hasTeamReviewRequest(raw: ReadonlyArray<ReviewRequestFields> | undefined) {
  return (raw ?? []).some(
    (request) =>
      trimmed(request.login) === null &&
      (trimmed(request.slug) !== null || trimmed(request.name) !== null),
  );
}

function toCheckStatus(raw: CheckFields) {
  const status = raw.status?.trim().toUpperCase();
  if (status !== undefined && status !== "COMPLETED" && status !== "") {
    return "pending";
  }
  switch ((raw.conclusion ?? raw.state)?.trim().toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "ACTION_REQUIRED":
      return "action-required";
    case "FAILURE":
    case "ERROR":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
      return "failure";
    case "CANCELLED":
      return "cancelled";
    case "SKIPPED":
      return "skipped";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "neutral";
  }
}

const UNSET_TIMESTAMP = "0001-01-01T00:00:00Z";

const STILL_RUNNING = "9999-12-31T23:59:59Z";

function realTimestamp(value: string | null | undefined) {
  const at = trimmed(value);
  return at === null || at === UNSET_TIMESTAMP ? null : at;
}

function isNamelessCheck(raw: CheckFields) {
  return trimmed(raw.name) === null && trimmed(raw.context) === null;
}

function toCheckEntries(raw: ReadonlyArray<CheckFields> | null | undefined) {
  return (raw ?? []).flatMap((check) => {
    const name = trimmed(check.name) ?? trimmed(check.context);
    if (name === null) return [];
    const status = toCheckStatus(check);
    return [
      {
        check: {
          name,
          status,
          description: trimmed(check.description),
          url: trimmed(check.detailsUrl) ?? trimmed(check.targetUrl),
          ...(typeof check.isRequired === "boolean" ? { required: check.isRequired } : {}),
        },
        workflowName: trimmed(check.workflowName),
        at:
          status === "pending"
            ? STILL_RUNNING
            : (realTimestamp(check.completedAt) ?? realTimestamp(check.startedAt)),
      },
    ];
  }) satisfies ReadonlyArray<{
    readonly check: PullRequestCheck;
    readonly workflowName: string | null;
    readonly at: string | null;
  }>;
}

function rollupChecksState(raw: ReadonlyArray<CheckFields> | null | undefined) {
  return rollupCheckStatuses([
    ...toChecks(raw).map((check) => check.status),
    ...(raw ?? []).filter(isNamelessCheck).map((check) => toCheckStatus(check)),
  ]);
}

function toChecks(raw: ReadonlyArray<CheckFields> | null | undefined) {
  return dedupeChecks(toCheckEntries(raw));
}

function isReviewVerdict(reviewState: string | null) {
  switch (reviewState?.toUpperCase()) {
    case "APPROVED":
    case "CHANGES_REQUESTED":
    case "DISMISSED":
      return true;
    default:
      return false;
  }
}

interface RemarkFields {
  readonly id: string;
  readonly lastEditedAt: string | null;
  readonly author: ActorFields | null;
  readonly body: string;
  readonly url: string | null;
  readonly isMinimized: boolean;
}

function toComments(raw: {
  readonly comments: ReadonlyArray<RemarkFields & { readonly createdAt: string }>;
  readonly reviews: ReadonlyArray<
    RemarkFields & { readonly state: string; readonly submittedAt: string | null }
  >;
}) {
  const issueComments = raw.comments
    .filter((comment) => !comment.isMinimized)
    .map(
      (comment) =>
        ({
          id: comment.id,
          kind: "issue-comment",
          author: toActor(comment.author),
          body: comment.body ?? "",
          createdAt: comment.createdAt,
          editedAt: comment.lastEditedAt ?? null,
          url: trimmed(comment.url),
          path: null,
          reviewState: null,
        }) satisfies PullRequestComment,
    );
  const reviews = raw.reviews.flatMap((review) => {
    const submittedAt = trimmed(review.submittedAt);
    const reviewState = trimmed(review.state);
    if (
      review.isMinimized ||
      submittedAt === null ||
      ((review.body ?? "").trim().length === 0 && !isReviewVerdict(reviewState))
    ) {
      return [] satisfies ReadonlyArray<PullRequestComment>;
    }
    return [
      {
        id: review.id,
        kind: "review",
        author: toActor(review.author),
        body: review.body ?? "",
        createdAt: submittedAt,
        editedAt: review.lastEditedAt ?? null,
        url: trimmed(review.url),
        path: null,
        reviewState,
      },
    ] satisfies ReadonlyArray<PullRequestComment>;
  });
  return [...issueComments, ...reviews].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  ) satisfies ReadonlyArray<PullRequestComment>;
}

function toCommits(
  commits: ReadonlyArray<{
    readonly oid: string;
    readonly messageHeadline: string;
    readonly committedDate: string;
    readonly authors: ReadonlyArray<Parameters<typeof toCommitActor>[0]>;
  }>,
) {
  return commits.map((commit) => ({
    oid: commit.oid,
    messageHeadline: commit.messageHeadline,
    committedDate: commit.committedDate,
    authors: commit.authors.flatMap((author) => toCommitActor(author) ?? []),
  }));
}

function toListItem(raw: ListItemFields): GitHubPullRequestListItem;
function toListItem(raw: ListItemFields) {
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: toActor(raw.author),
    headBranch: raw.headRefName,
    baseBranch: raw.baseRefName,
    state: toState(raw),
    isDraft: raw.isDraft ?? false,
    mergeability: toMergeability(raw.mergeable),
    reviewDecision: toReviewDecisionWithReviews(raw.reviewDecision, raw.latestReviews),
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    reviewRequestLogins: toReviewRequestLogins(raw.reviewRequests),
    hasTeamReviewRequest: hasTeamReviewRequest(raw.reviewRequests),
    labels: toLabels(raw.labels),
    checksState: rollupChecksState(raw.statusCheckRollup),
  } satisfies GitHubPullRequestListItem;
}

interface DetailFields extends ListItemFields {
  readonly isCrossRepository?: boolean | undefined;
  readonly headRepositoryOwner?: { readonly login: string } | null | undefined;
  readonly headRefOid?: string | null | undefined;
  readonly body?: string | undefined;
  readonly changedFiles?: number | undefined;
  readonly closedAt?: string | null | undefined;
  readonly autoMergeRequest?:
    | { readonly mergeMethod?: string | null | undefined }
    | null
    | undefined;
}

function toDetail(raw: DetailFields) {
  const autoMergeMethod = toMergeMethod(raw.autoMergeRequest?.mergeMethod);
  return {
    ...toListItem(raw),
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    headRepositoryOwner: trimmed(raw.headRepositoryOwner?.login),
    headSha: trimmed(raw.headRefOid),
    body: raw.body ?? "",
    changedFiles: raw.changedFiles ?? 0,
    mergedAt: trimmed(raw.mergedAt),
    closedAt: trimmed(raw.closedAt),
    checks: toChecks(raw.statusCheckRollup),
    ...(raw.autoMergeRequest === undefined
      ? {}
      : { autoMergeEnabled: raw.autoMergeRequest !== null }),
    ...(autoMergeMethod === undefined ? {} : { autoMergeMethod }),
  } satisfies GitHubPullRequestDetail;
}

const decodeUnknownList = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeWorkflowRuns = decodeJsonResult(RawWorkflowRunsSchema);
const decodeFileEntry = Schema.decodeUnknownExit(RawPullRequestFileSchema);
const decodeRow = Schema.decodeUnknownExit(PullRequestRow);

const LenientRows = Schema.Struct({
  pageInfo: ListingPageInfo,
  nodes: Schema.NullOr(Schema.Array(Schema.Unknown)),
});

/** The generated search, with its rows decoded by `toPullRequestRows` instead. */
export const LenientPullRequestSearch = GraphQL.query(PullRequestSearch.name, {
  document: PullRequestSearch.document,
  variables: PullRequestSearch.variables,
  result: Schema.Struct({ search: LenientRows }),
});

/** The generated repository list, with its rows decoded by `toPullRequestRows` instead. */
export const LenientPullRequestList = GraphQL.query(PullRequestList.name, {
  document: PullRequestList.document,
  variables: PullRequestList.variables,
  result: Schema.Struct({
    repository: Schema.NullOr(Schema.Struct({ pullRequests: LenientRows })),
  }),
});

type DecodeFailure = Cause.Cause<Schema.SchemaError>;

/**
 * A listing page's rows, decoded one at a time against the generated row: a node that is not a pull
 * request, or one whose fields no longer decode, is skipped rather than blanking the whole page.
 * `rawCount` counts them all, so a skipped row cannot hide a next page.
 */
export function toPullRequestRows(
  connection:
    | { readonly pageInfo: PageInfoFields; readonly nodes: ReadonlyArray<unknown> | null }
    | null
    | undefined,
): {
  readonly rows: ReadonlyArray<{
    readonly item: GitHubPullRequestListItem;
    readonly repository: string | null;
  }>;
  readonly rawCount: number;
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
};
export function toPullRequestRows(
  connection:
    | { readonly pageInfo: PageInfoFields; readonly nodes: ReadonlyArray<unknown> | null }
    | null
    | undefined,
) {
  const nodes = connection?.nodes ?? [];
  return {
    rows: nodes.flatMap((entry) => toRow(entry) ?? []),
    rawCount: nodes.length,
    hasNextPage: connection?.pageInfo.hasNextPage === true,
    endCursor: nextCursorOf(connection?.pageInfo),
  } satisfies {
    readonly rows: ReadonlyArray<{
      readonly item: GitHubPullRequestListItem;
      readonly repository: string | null;
    }>;
    readonly rawCount: number;
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

function toRow(
  entry: unknown,
): { readonly item: GitHubPullRequestListItem; readonly repository: string | null } | null;
function toRow(entry: unknown) {
  const decodedNode = decodeRow(entry);
  if (!Exit.isSuccess(decodedNode))
    return null satisfies {
      readonly item: GitHubPullRequestListItem;
      readonly repository: string | null;
    } | null;
  const node = decodedNode.value;
  const stack = toStackMembership(node);
  const reviewRequests = nodesOf(node.reviewRequests).flatMap((request) => {
    const reviewer = request.requestedReviewer;
    if (reviewer === null)
      return [] satisfies ReadonlyArray<ReviewRequestFields> as ReadonlyArray<ReviewRequestFields>;
    const login = "login" in reviewer ? trimmed(reviewer.login) : null;
    if (login !== null)
      return [
        { login },
      ] satisfies ReadonlyArray<ReviewRequestFields> as ReadonlyArray<ReviewRequestFields>;
    const slug = "slug" in reviewer ? trimmed(reviewer.slug) : null;
    return (slug === null
      ? []
      : [
          { slug },
        ]) satisfies ReadonlyArray<ReviewRequestFields> as ReadonlyArray<ReviewRequestFields>;
  });
  return {
    item: {
      ...toListItem({
        ...node,
        latestReviews: nodesOf(node.latestReviews),
        reviewRequests,
        labels: nodesOf(node.labels),
        statusCheckRollup: rollupStates(node.commits),
      }),
      ...(stack === undefined ? {} : { stack }),
    },
    repository: trimmed(node.repository.nameWithOwner),
  } satisfies {
    readonly item: GitHubPullRequestListItem;
    readonly repository: string | null;
  } | null;
}

function rollupStates(commits: {
  readonly nodes: ReadonlyArray<{
    readonly commit: { readonly statusCheckRollup: { readonly state: string } | null };
  } | null> | null;
}): ReadonlyArray<CheckFields>;
function rollupStates(commits: {
  readonly nodes: ReadonlyArray<{
    readonly commit: { readonly statusCheckRollup: { readonly state: string } | null };
  } | null> | null;
}) {
  return nodesOf(commits).flatMap((commitNode) => {
    const state = trimmed(commitNode.commit.statusCheckRollup?.state);
    return state === null ? [] : [{ state }];
  }) satisfies ReadonlyArray<CheckFields>;
}

export interface GitHubPullRequestSearchItem extends GitHubPullRequestListItem {
  readonly repository: string;
}

export function toStackMembership(raw: {
  readonly stack?: {
    readonly number: number;
    readonly size: number;
    readonly baseRefName: string;
  } | null;
  readonly stackEntry?: { readonly position: number } | null;
}): PullRequestStackMembership | undefined;
export function toStackMembership(raw: {
  readonly stack?: {
    readonly number: number;
    readonly size: number;
    readonly baseRefName: string;
  } | null;
  readonly stackEntry?: { readonly position: number } | null;
}) {
  return (
    raw.stack && raw.stackEntry
      ? {
          number: raw.stack.number,
          size: raw.stack.size,
          base: raw.stack.baseRefName,
          position: raw.stackEntry.position,
        }
      : undefined
  ) satisfies PullRequestStackMembership | undefined;
}

const REPOSITORY_PART = /^[A-Za-z0-9._-]+$/;

/**
 * The variables of one pull request lookup, or null for a selector or number GitHub cannot
 * name: a batch would send it, and GitHub would refuse the whole request rather than its part.
 */
export function repositoryLookup(repository: string) {
  const [owner, name, ...rest] = repository.trim().split("/");
  if (rest.length > 0 || owner === undefined || name === undefined) return null;
  return REPOSITORY_PART.test(owner) && REPOSITORY_PART.test(name) ? { owner, name } : null;
}

export function pullRequestLookup(changeRequest: {
  readonly repository: string;
  readonly number: number;
}): { readonly owner: string; readonly name: string; readonly number: number } | null;
export function pullRequestLookup(changeRequest: {
  readonly repository: string;
  readonly number: number;
}) {
  const repository = repositoryLookup(changeRequest.repository);
  if (repository === null)
    return null satisfies {
      readonly owner: string;
      readonly name: string;
      readonly number: number;
    } | null;
  const { number } = changeRequest;
  return (
    Number.isSafeInteger(number) && number > 0 && number <= 2_147_483_647
      ? { ...repository, number }
      : null
  ) satisfies { readonly owner: string; readonly name: string; readonly number: number } | null;
}

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly closedAt: string | null;
  readonly mergedAt: string | null;
  readonly updatedAt: string;
  readonly author: PullRequestActor | null;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly reviewDecision: PullRequestReviewDecision | null;
  readonly checksState: PullRequestChecksState | null;
  readonly mergeability: PullRequestMergeability;
  /** Null when GitHub says the pull request is in no stack; absent when the read did not ask. */
  readonly stack?: PullRequestStackMembership | null;
}

/** The summary a linked thread keeps current, from one slice of the batched read. */
export function toPullRequestSummary(pr: SummarizedPullRequest) {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    headBranch: pr.headRefName,
    baseBranch: pr.baseRefName,
    state: toState(pr),
    isDraft: pr.isDraft,
    closedAt: trimmed(pr.closedAt),
    mergedAt: trimmed(pr.mergedAt),
    updatedAt: pr.updatedAt,
    author: toActor(pr.author),
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    reviewDecision: toReviewDecisionWithReviews(pr.reviewDecision, nodesOf(pr.latestReviews)),
    checksState: rollupChecksState(rollupStates(pr.commits)),
    mergeability: toMergeability(pr.mergeable),
    ...(pr.stack === undefined ? {} : { stack: toStackMembership(pr) ?? null }),
  } satisfies GitHubPullRequestSummary;
}

export interface GitHubPullRequestWatchFingerprint {
  readonly status: string;
  readonly remarks: string;
}

type EditedConnection = WatchedPullRequest["comments"] | WatchedPullRequest["reviews"];
type StateCounts = ReadonlyArray<{ readonly state: string; readonly count: number }> | null;

const newestEdit = (connection: EditedConnection) =>
  (connection?.nodes ?? []).reduce(
    (newest, node) =>
      node?.lastEditedAt != null && node.lastEditedAt > newest ? node.lastEditedAt : newest,
    "",
  );

const stateCounts = (counts: StateCounts) =>
  (counts ?? [])
    .filter(({ count }) => count > 0)
    .map(({ state, count }) => `${state}:${count}`)
    .toSorted()
    .join(",");

export function toPullRequestWatchFingerprint(pr: WatchedPullRequest) {
  const contexts = pr.commits.nodes?.[0]?.commit.statusCheckRollup?.contexts;
  return {
    status: [
      pr.state,
      pr.mergeable,
      pr.headRefOid,
      stateCounts(contexts?.checkRunCountsByState ?? null),
      stateCounts(contexts?.statusContextCountsByState ?? null),
      pr.mergeQueueRemovals?.filteredCount ?? 0,
    ].join(" "),
    remarks: [
      pr.comments.totalCount,
      newestEdit(pr.comments),
      pr.reviews?.totalCount ?? 0,
      newestEdit(pr.reviews),
      pr.reviewThreads.totalCount,
    ].join(" "),
  };
}

export interface GitHubPullRequestCore extends GitHubPullRequestDetail {
  readonly mergeQueueRemoval?: PullRequestMergeQueueRemoval;
  readonly maintainerCanModify: boolean;
  readonly canEditMaintainerEdits: boolean;
  readonly reviewRequestTeams: ReadonlyArray<PullRequestActor>;
  readonly viewerAccess: GitHubViewerAccess & GitHubRepositoryAccess;
  readonly comparison: GitHubBaseComparison | null;
  readonly checksTruncated: boolean;
}

type CoreRequestedReviewer = NonNullable<
  NonNullable<
    NonNullable<NonNullable<PullRequestCore.Result["repository"]>["pullRequest"]>["reviewRequests"]
  >["nodes"]
>[number];

/** Null for a repository or number that names no pull request the viewer can see. */
export function toPullRequestCore(result: PullRequestCore.Result): GitHubPullRequestCore | null;
export function toPullRequestCore(result: PullRequestCore.Result) {
  const repository = result.repository;
  const pr = repository?.pullRequest;
  if (repository == null || pr == null) return null satisfies GitHubPullRequestCore | null;
  const contexts = nodesOf(pr.commits)[0]?.commit.statusCheckRollup?.contexts;
  const removal = nodesOf(pr.mergeQueueRemovals).at(-1);
  return {
    ...(removal === undefined || !("id" in removal)
      ? {}
      : {
          mergeQueueRemoval: {
            id: removal.id,
            removedAt: removal.createdAt,
            reason: trimmed(removal.reason),
          },
        }),
    reviewRequestTeams: nodesOf(pr.reviewRequests).flatMap(
      ({ requestedReviewer }) => toRequestedTeam(requestedReviewer) ?? [],
    ),
    ...toDetail({
      ...pr,
      latestReviews: [],
      reviewRequests: nodesOf(pr.reviewRequests).flatMap(
        ({ requestedReviewer }: NonNullable<CoreRequestedReviewer>) =>
          requestedReviewer === null
            ? []
            : [
                {
                  login: "login" in requestedReviewer ? requestedReviewer.login : null,
                  slug: "slug" in requestedReviewer ? requestedReviewer.slug : null,
                  name:
                    "teamName" in requestedReviewer
                      ? requestedReviewer.teamName
                      : "name" in requestedReviewer
                        ? requestedReviewer.name
                        : null,
                },
              ],
      ),
      labels: nodesOf(pr.labels),
      statusCheckRollup: toCheckContexts(nodesOf(contexts)),
    }),
    headRepositoryNameWithOwner: trimmed(pr.headRepository?.nameWithOwner),
    maintainerCanModify: pr.maintainerCanModify,
    canEditMaintainerEdits:
      pr.state === "OPEN" &&
      pr.isCrossRepository &&
      pr.viewerDidAuthor &&
      pr.headRepositoryOwner?.__typename === "User" &&
      pr.headRepository !== null &&
      pr.headRef !== null,
    viewerAccess: {
      canWrite: toCanWrite(repository.viewerPermission),
      canDeleteBranch: toCanWrite(pr.headRepository?.viewerPermission) && pr.headRef !== null,
      canTriage: toCanTriage(repository.viewerPermission),
      ...toPullRequestViewerFields(pr),
      canMergeNow: IMMEDIATELY_MERGEABLE.has(pr.mergeStateStatus),
      mergeCapabilities: {
        merge: repository.mergeCommitAllowed,
        squash: repository.squashMergeAllowed,
        rebase: repository.rebaseMergeAllowed,
      },
      autoMergeAllowed: repository.autoMergeAllowed,
    },
    comparison:
      pr.state !== "OPEN" || pr.baseRef?.compare == null
        ? null
        : {
            behindBy: pr.baseRef.compare.behindBy,
            viewerCanUpdate: pr.viewerCanUpdateBranch,
          },
    checksTruncated: contexts?.pageInfo.hasNextPage === true,
  } satisfies GitHubPullRequestCore | null;
}

export interface GitHubWorkflowRunPage {
  readonly runs: ReadonlyArray<GitHubWorkflowRunApproval>;
  readonly rawCount: number;
}

export function decodeWorkflowRunsJson(raw: string) {
  const decoded = decodeWorkflowRuns(raw);
  if (!Result.isSuccess(decoded)) return Result.fail(decoded.failure);
  return Result.succeed({
    runs: decoded.success.workflow_runs.map((run) => ({
      id: run.id,
      name: trimmed(run.name) ?? `Workflow run ${run.id}`,
      url: trimmed(run.html_url),
    })),
    rawCount: decoded.success.workflow_runs.length,
  });
}

const UNFINISHED_WORKFLOW_RUN_STATUSES = new Set([
  "requested",
  "queued",
  "pending",
  "waiting",
  "in_progress",
]);

/** Workflow runs GitHub has not finished, which may have no check runs on the head yet. */
export function decodeUnfinishedWorkflowRunsJson(
  raw: string,
): Result.Result<ReadonlyArray<GitHubWorkflowRunApproval>, DecodeFailure>;
export function decodeUnfinishedWorkflowRunsJson(raw: string) {
  const decoded = decodeWorkflowRuns(raw);
  if (!Result.isSuccess(decoded))
    return Result.fail(decoded.failure) satisfies Result.Result<
      ReadonlyArray<GitHubWorkflowRunApproval>,
      DecodeFailure
    >;
  return Result.succeed(
    decoded.success.workflow_runs
      .filter((run) => UNFINISHED_WORKFLOW_RUN_STATUSES.has(run.status ?? ""))
      .map((run) => ({
        id: run.id,
        name: trimmed(run.name) ?? `Workflow run ${run.id}`,
        url: trimmed(run.html_url),
      })),
  ) satisfies Result.Result<ReadonlyArray<GitHubWorkflowRunApproval>, DecodeFailure>;
}

/** One page of open pull requests on one head branch; an unseen repository is an empty page. */
export function toPullRequestHeads(result: PullRequestHeads.Result) {
  const connection = result.repository?.pullRequests;
  return {
    heads: nodesOf(connection).map((pullRequest) => ({
      number: pullRequest.number,
      headSha: pullRequest.headRefOid,
      isCrossRepository: pullRequest.isCrossRepository,
      headRepositoryOwner: trimmed(pullRequest.headRepositoryOwner?.login),
    })),
    nextCursor: nextCursorOf(connection?.pageInfo),
  };
}

export interface GitHubPullRequestActivityPage {
  readonly nonMergeCommitIds: ReadonlyArray<string>;
  readonly author?: PullRequestActor | null;
  readonly commits?: ReadonlyArray<PullRequestCommit>;
  readonly remarks: ReadonlyArray<PullRequestComment>;
  readonly nextCommentsCursor: string | null;
  readonly nextReviewsCursor: string | null;
}

/** One page of the activity read; null for a pull request the viewer cannot see. */
export function toPullRequestActivityPage(
  result: PullRequestActivity.Result,
): GitHubPullRequestActivityPage | null;
export function toPullRequestActivityPage(result: PullRequestActivity.Result) {
  const pr = result.repository?.pullRequest;
  if (pr == null) return null satisfies GitHubPullRequestActivityPage | null;
  return {
    nonMergeCommitIds: nodesOf(pr.commits).flatMap(({ commit }) =>
      commit.parents.totalCount > 1 ? [] : [commit.id],
    ),
    ...(pr.author === undefined ? {} : { author: toActor(pr.author) }),
    ...(pr.commits === undefined
      ? {}
      : {
          commits: toCommits(
            nodesOf(pr.commits).map(({ commit }) => ({
              ...commit,
              authors: nodesOf(commit.authors).map((author) => ({
                ...author,
                login: author.user?.login ?? null,
              })),
            })),
          ),
        }),
    remarks: toComments({ comments: nodesOf(pr.comments), reviews: nodesOf(pr.reviews) }),
    nextCommentsCursor: nextCursorOf(pr.comments?.pageInfo),
    nextReviewsCursor: nextCursorOf(pr.reviews?.pageInfo),
  } satisfies GitHubPullRequestActivityPage | null;
}

export function toPullRequestCommitStats(result: PullRequestCommitStats.Result) {
  return new Map(
    (result.nodes ?? []).flatMap((commit) =>
      commit?.__typename === "Commit"
        ? [
            [
              commit.oid,
              {
                additions: Math.max(0, commit.additions),
                deletions: Math.max(0, commit.deletions),
              },
            ] as const,
          ]
        : [],
    ),
  );
}

/** A check context as the rollup reports it; opaque outside this module. */
export type GitHubCheckContext = CheckFields;

function toCheckContexts(nodes: ReadonlyArray<CheckContext>) {
  return nodes.map((check) =>
    check.__typename === "CheckRun"
      ? { ...check, workflowName: check.checkSuite.workflowRun?.workflow.name ?? null }
      : check,
  );
}

/** One page of the head commit's check contexts; null for a pull request GitHub did not find. */
export function toPullRequestCheckContextsPage(result: PullRequestCheckContexts.Result): {
  readonly headSha: string;
  readonly contexts: ReadonlyArray<GitHubCheckContext>;
  readonly nextCursor: string | null;
} | null;
export function toPullRequestCheckContextsPage(result: PullRequestCheckContexts.Result) {
  const pr = result.repository?.pullRequest;
  if (pr == null)
    return null satisfies {
      readonly headSha: string;
      readonly contexts: ReadonlyArray<GitHubCheckContext>;
      readonly nextCursor: string | null;
    } | null;
  const contexts = nodesOf(pr.commits)[0]?.commit.statusCheckRollup?.contexts;
  return {
    headSha: pr.headRefOid,
    contexts: toCheckContexts(nodesOf(contexts)),
    nextCursor: nextCursorOf(contexts?.pageInfo),
  } satisfies {
    readonly headSha: string;
    readonly contexts: ReadonlyArray<GitHubCheckContext>;
    readonly nextCursor: string | null;
  } | null;
}

export function pullRequestChecksFromContexts(contexts: ReadonlyArray<GitHubCheckContext>): {
  readonly checks: ReadonlyArray<PullRequestCheck>;
  readonly checksState: PullRequestChecksState | null;
};
export function pullRequestChecksFromContexts(contexts: ReadonlyArray<GitHubCheckContext>) {
  return { checks: toChecks(contexts), checksState: rollupChecksState(contexts) } satisfies {
    readonly checks: ReadonlyArray<PullRequestCheck>;
    readonly checksState: PullRequestChecksState | null;
  };
}

export interface GitHubReviewThreadComments {
  readonly comments: ReadonlyArray<PullRequestComment>;
  readonly dismissalsByReviewId: ReadonlyMap<string, string>;
  readonly reviewThreads: ReadonlyArray<PullRequestReviewThread>;
  readonly commentCount: number;
  readonly truncated: boolean;
  readonly reviewThreadsTruncated: boolean;
  readonly reactions: ReadonlyArray<PullRequestReaction>;
  readonly reactionsById: ReadonlyMap<string, ReadonlyArray<PullRequestReaction>>;
  readonly editedAtById: ReadonlyMap<string, string>;
  readonly reviewers: ReadonlyArray<PullRequestActor>;
  readonly avatarsByLogin: ReadonlyMap<string, string>;
  readonly botLogins: ReadonlySet<string>;
  /**
   * Empty wherever the read never happened (an install too old for the field, a degraded page),
   * which the caller reads as "keep the `gh pr view` list" rather than as "this pull request has
   * no commits".
   */
  readonly commits: ReadonlyArray<PullRequestCommit>;
  readonly viewer: { readonly canUpdate: boolean; readonly didAuthor: boolean };
}

export interface GitHubReviewThreadEntry {
  readonly thread: PullRequestReviewThread;
  readonly commentCount: number;
  readonly nextCommentCursor: string | null;
}

export interface GitHubReviewThreadPage {
  readonly threads: ReadonlyArray<GitHubReviewThreadEntry>;
  readonly nextCursor: string | null;
  readonly reactions: ReadonlyArray<PullRequestReaction>;
  readonly reactionsById: ReadonlyMap<string, ReadonlyArray<PullRequestReaction>>;
  readonly editedAtById: ReadonlyMap<string, string>;
  readonly reviewers: ReadonlyArray<PullRequestActor>;
  readonly avatarsByLogin: ReadonlyMap<string, string>;
  readonly botLogins: ReadonlySet<string>;
  readonly commits: ReadonlyArray<PullRequestCommit>;
  readonly viewer: { readonly canUpdate: boolean; readonly didAuthor: boolean };
  readonly dismissalsByReviewId: ReadonlyMap<string, string>;
  readonly nextDismissalCursor: string | null;
}

export function reviewThreadConversation(threads: ReadonlyArray<PullRequestReviewThread>) {
  return threads.flatMap((thread) =>
    thread.comments.map(
      (comment) =>
        ({
          id: comment.id,
          kind: "review-comment",
          author: comment.author,
          body: comment.body,
          createdAt: comment.createdAt,
          editedAt: comment.editedAt ?? null,
          url: comment.url,
          path: thread.path,
          reviewState: null,
          reactions: comment.reactions ?? [],
        }) satisfies PullRequestComment,
    ),
  ) satisfies ReadonlyArray<PullRequestComment>;
}

function toDismissalEntries(connection: ReviewThreadsPullRequest["reviewDismissals"]) {
  const entries = new Map<string, string>();
  for (const node of nodesOf(connection)) {
    if (!("dismissalMessage" in node)) continue;
    const reviewId = trimmed(node.review?.id);
    const message = trimmed(node.dismissalMessage);
    if (reviewId !== null && message !== null) entries.set(reviewId, message);
  }
  return entries;
}

/** One further page of dismissal events, in the shape the thread read's own page carries. */
export function toReviewDismissalsPage(result: ReviewDismissals.Result) {
  const items = result.repository?.pullRequest?.timelineItems;
  if (items === undefined) return null;
  return {
    dismissalsByReviewId: toDismissalEntries(items),
    nextCursor: nextCursorOf(items.pageInfo),
  };
}

function toThreadComment(comment: ThreadComment, viewer: string | null) {
  const reviewUrl = trimmed(comment.pullRequestReview?.url);
  return {
    id: comment.id,
    author: toActor(comment.author),
    body: comment.body,
    createdAt: comment.createdAt,
    editedAt: comment.lastEditedAt,
    url: trimmed(comment.url),
    ...(reviewUrl === null ? {} : { reviewUrl }),
    reactions: toReactions(comment.reactionGroups, viewer),
  };
}

type ReviewThreadsPullRequest = NonNullable<
  NonNullable<ReviewThreads.Result["repository"]>["pullRequest"]
>;

function toReviewThreadEntries(threads: ReviewThreadPage, viewer: string | null) {
  const threadNodes = nodesOf(threads);
  const entries = threadNodes.flatMap((thread) => {
    const path = trimmed(thread.path);
    const id = trimmed(thread.id);
    const loaded = nodesOf(thread.comments);
    const comments = loaded.filter((comment) => !comment.isMinimized);
    if (path === null || id === null || comments.length === 0)
      return [] satisfies ReadonlyArray<GitHubReviewThreadEntry>;
    return [
      {
        thread: {
          id,
          path,
          line: thread.line !== null && thread.line > 0 ? thread.line : null,
          side: thread.diffSide.toUpperCase() === "LEFT" ? "left" : "right",
          isResolved: thread.isResolved,
          isOutdated: thread.isOutdated,
          comments: comments.map((comment) => toThreadComment(comment, viewer)),
        },
        commentCount: thread.comments.totalCount - (loaded.length - comments.length),
        nextCommentCursor: nextCursorOf(thread.comments.pageInfo),
      },
    ] satisfies ReadonlyArray<GitHubReviewThreadEntry>;
  });
  return {
    entries,
    nextCursor: nextCursorOf(threads.pageInfo),
    authors: threadNodes.flatMap((thread) =>
      nodesOf(thread.comments).map((comment) => comment.author),
    ),
  };
}

function collectActors(raws: ReadonlyArray<ActorFields | null | undefined>) {
  const avatarsByLogin = new Map<string, string>();
  const botLogins = new Set<string>();
  for (const raw of raws) {
    const login = trimmed(raw?.login);
    const avatarUrl = trimmed(raw?.avatarUrl);
    if (login !== null && avatarUrl !== null) avatarsByLogin.set(login, avatarUrl);
    if (login !== null && toActor(raw)?.isBot) botLogins.add(login);
  }
  return { avatarsByLogin, botLogins };
}

export function toLaterReviewThreadPage(result: ReviewThreadPages.Result) {
  const threads = result.repository?.pullRequest?.reviewThreads;
  if (threads === undefined)
    return null satisfies Pick<
      GitHubReviewThreadPage,
      "threads" | "nextCursor" | "avatarsByLogin" | "botLogins"
    > | null;
  const { entries, nextCursor, authors } = toReviewThreadEntries(
    threads,
    trimmed(result.viewer.login),
  );
  return { threads: entries, nextCursor, ...collectActors(authors) } satisfies Pick<
    GitHubReviewThreadPage,
    "threads" | "nextCursor" | "avatarsByLogin" | "botLogins"
  > | null;
}

/** One page of review threads; null for a pull request the viewer cannot see. */
export function toReviewThreadPage(result: ReviewThreads.Result) {
  const pullRequest = result.repository?.pullRequest;
  if (pullRequest == null) return null satisfies GitHubReviewThreadPage | null;
  const viewer = trimmed(result.viewer.login);
  const page = toReviewThreadEntries(pullRequest.reviewThreads, viewer);
  const requestedReviewers = nodesOf(pullRequest.reviewRequests).map(
    (node) => node.requestedReviewer,
  );
  const latestReviews = nodesOf(pullRequest.latestReviews).filter((node) => !node.isMinimized);
  const comments = nodesOf(pullRequest.comments);
  const reviews = nodesOf(pullRequest.reviews);
  const { avatarsByLogin, botLogins } = collectActors([
    pullRequest.author,
    ...comments.map((node) => node.author),
    ...reviews.map((node) => node.author),
    ...requestedReviewers,
    ...latestReviews.map((node) => node.author),
    ...page.authors,
  ]);
  const reviewers = new Map<string, PullRequestActor>();
  for (const raw of [...requestedReviewers, ...latestReviews.map((node) => node.author)]) {
    const actor = toActor(raw) ?? toRequestedTeam(raw);
    if (actor !== null && !reviewers.has(actor.login)) reviewers.set(actor.login, actor);
  }
  const commits: PullRequestCommit[] = [];
  for (const { commit } of nodesOf(pullRequest.commits)) {
    const oid = trimmed(commit.oid);
    if (oid === null) continue;
    const committedDate = trimmed(commit.committedDate);
    if (committedDate === null) continue;
    commits.push({
      oid,
      messageHeadline: commit.messageHeadline,
      committedDate,
      authors: nodesOf(commit.authors).flatMap((author) => toGraphqlCommitActor(author) ?? []),
    });
  }
  const reactionsById = new Map<string, ReadonlyArray<PullRequestReaction>>();
  const editedAtById = new Map<string, string>();
  for (const node of [...comments, ...reviews]) {
    const id = trimmed(node.id);
    if (id === null) continue;
    const editedAt = trimmed(node.lastEditedAt);
    if (editedAt !== null) editedAtById.set(id, editedAt);
    const reactions = toReactions(node.reactionGroups, viewer);
    if (reactions.length > 0) reactionsById.set(id, reactions);
  }
  return {
    threads: page.entries,
    nextCursor: page.nextCursor,
    reactions: toReactions(pullRequest.reactionGroups, viewer),
    reactionsById,
    editedAtById,
    reviewers: [...reviewers.values()],
    avatarsByLogin,
    botLogins,
    commits,
    viewer: toPullRequestViewerFields(pullRequest),
    dismissalsByReviewId: toDismissalEntries(pullRequest.reviewDismissals),
    nextDismissalCursor: nextCursorOf(pullRequest.reviewDismissals.pageInfo),
  } satisfies GitHubReviewThreadPage | null;
}

/** The rest of one thread's comments, in the shape the first page already delivered them. */
export function toReviewThreadCommentsPage(result: ReviewThreadComments.Result) {
  const viewer = trimmed(result.viewer.login);
  const thread = result.node?.__typename === "PullRequestReviewThread" ? result.node : null;
  const pullRequestId = result.repository?.pullRequest?.id;
  const loaded = nodesOf(thread?.comments);
  const comments = loaded.filter((comment) => !comment.isMinimized);
  return {
    belongsToPullRequest: pullRequestId !== undefined && pullRequestId === thread?.pullRequest.id,
    comments: comments.map((comment) => toThreadComment(comment, viewer)),
    hiddenCount: loaded.length - comments.length,
    nextCursor: nextCursorOf(thread?.comments.pageInfo),
  };
}

export interface GitHubRepositoryAccess {
  readonly mergeCapabilities: PullRequestMergeCapabilities;
  readonly autoMergeAllowed: boolean;
  readonly canWrite: boolean;
}

/** States in which `gh pr merge --auto` merges at once instead of arming auto-merge. */
export const IMMEDIATELY_MERGEABLE: ReadonlySet<string> = new Set([
  "CLEAN",
  "HAS_HOOKS",
  "UNSTABLE",
]);

/**
 * GitHub answers null only to a GitHub App installation, and no API says what an installation
 * may do, so null is granted and GitHub refuses whatever the app was not given.
 */
export function toCanWrite(viewerPermission: string | null | undefined) {
  if (viewerPermission === null) return true;
  switch (viewerPermission?.trim().toUpperCase()) {
    case "ADMIN":
    case "MAINTAIN":
    case "WRITE":
      return true;
    default:
      return false;
  }
}

function toCanTriage(viewerPermission: string | null | undefined) {
  return viewerPermission?.trim().toUpperCase() === "TRIAGE" || toCanWrite(viewerPermission);
}

export interface GitHubBaseComparison {
  readonly behindBy: number | null;
  readonly viewerCanUpdate: boolean;
}

/**
 * The author is dropped because GitHub refuses a review request from them. Whoever was already
 * asked leads even when GitHub does not count them assignable, because a request that cannot be
 * seen cannot be taken back. Null for a repository the viewer cannot see.
 */
export function toReviewerCandidates(result: ReviewerCandidates.Result, query?: string) {
  const repository = result.repository;
  if (repository == null) return null;
  const pullRequest = repository.pullRequest;
  const author = trimmed(pullRequest?.author?.login);
  const candidates = new Map<string, PullRequestReviewerCandidate>();
  for (const { requestedReviewer: raw } of nodesOf(pullRequest?.reviewRequests)) {
    if (raw === null) continue;
    const slug = "slug" in raw ? trimmed(raw.slug) : null;
    const id = slug ?? ("login" in raw ? trimmed(raw.login) : null);
    if (id === null) continue;
    candidates.set(`${slug === null ? "user" : "team"} ${id}`, {
      id,
      kind: slug === null ? "user" : "team",
      login: slug === null ? id : (trimmed("combinedSlug" in raw ? raw.combinedSlug : null) ?? id),
      name: trimmed("teamName" in raw ? raw.teamName : "name" in raw ? raw.name : null),
      avatarUrl: trimmed(
        "teamAvatarUrl" in raw ? raw.teamAvatarUrl : "avatarUrl" in raw ? raw.avatarUrl : null,
      ),
      isRequested: true,
    });
  }
  const hostMatches = new Set<string>();
  for (const node of nodesOf(repository.assignableUsers)) {
    const login = trimmed(node.login);
    if (login !== null) hostMatches.add(login);
    if (login === null || login === author || candidates.has(`user ${login}`)) continue;
    candidates.set(`user ${login}`, {
      id: login,
      kind: "user",
      login,
      name: trimmed(node.name),
      avatarUrl: trimmed(node.avatarUrl),
      isRequested: false,
    });
  }
  return {
    candidates: [...candidates.values()].filter(
      (candidate) => !query?.trim() || (candidate.kind === "user" && hostMatches.has(candidate.id)),
    ),
    truncated: repository.assignableUsers.pageInfo.hasNextPage,
  };
}

const ReviewerRequestSchema = Schema.Struct({
  reviewers: Schema.Array(Schema.String),
  team_reviewers: Schema.Array(Schema.String),
});

export function buildReviewerRequest(
  reviewers: ReadonlyArray<{ readonly id: string; readonly kind: PullRequestReviewerKind }>,
): typeof ReviewerRequestSchema.Type;
export function buildReviewerRequest(
  reviewers: ReadonlyArray<{ readonly id: string; readonly kind: PullRequestReviewerKind }>,
) {
  return {
    reviewers: reviewers.flatMap((reviewer) => (reviewer.kind === "user" ? [reviewer.id] : [])),
    team_reviewers: reviewers.flatMap((reviewer) =>
      reviewer.kind === "team" ? [reviewer.id] : [],
    ),
  };
}

/**
 * The repository's labels, with the ones already on this pull request marked. A label the pull
 * request wears that the repository no longer defines — deleted since, or past the page — leads
 * the list anyway, because a label that cannot be seen cannot be taken off. Null for a repository
 * the viewer cannot see.
 */
export function toLabelCandidates(result: LabelCandidates.Result) {
  const repository = result.repository;
  if (repository == null) return null;
  const applied = new Set(
    nodesOf(repository.pullRequest?.labels).flatMap((label) => trimmed(label.name) ?? []),
  );
  const candidates = new Map<string, PullRequestLabelCandidate>();
  for (const node of nodesOf(repository.labels)) {
    const name = trimmed(node.name);
    if (name === null) continue;
    candidates.set(name, {
      name,
      color: trimmed(node.color),
      description: trimmed(node.description),
      isApplied: applied.has(name),
    });
  }
  const missing = [...applied].filter((name) => !candidates.has(name));
  return {
    candidates: [
      ...missing.map((name) => ({ name, color: null, description: null, isApplied: true })),
      ...candidates.values(),
    ],
    truncated: repository.labels?.pageInfo.hasNextPage === true,
  };
}

export function toRepositoryLabels(result: RepositoryLabels.Result) {
  const repository = result.repository;
  if (repository == null) return null;
  return {
    items: nodesOf(repository.labels).flatMap((node) => {
      const name = trimmed(node.name);
      return name === null ? [] : [{ name, color: trimmed(node.color) }];
    }),
    truncated: repository.labels?.pageInfo.hasNextPage === true,
  };
}

export function toRepositoryAuthors(result: RepositoryAuthors.Result) {
  const repository = result.repository;
  if (repository == null) return null;
  return {
    items: nodesOf(repository.mentionableUsers).flatMap((node) => {
      const login = trimmed(node.login);
      return login === null
        ? []
        : [{ login, name: trimmed(node.name), avatarUrl: trimmed(node.avatarUrl) }];
    }),
    truncated: repository.mentionableUsers.pageInfo.hasNextPage,
  };
}

/** The `search` string for {@link toRepositoryReferences}; a numeric query searches recent items. */
export function referenceSearchQuery(repository: string, query: string | undefined) {
  const text = query?.trim() ?? "";
  const titled = text.length === 0 || /^\d+$/.test(text) ? [] : [`in:title ${searchPhrase(text)}`];
  return [`repo:${repository}`, ...titled, "sort:updated-desc"].join(" ");
}

/**
 * Quoting is the whole defence: outside quotes GitHub reads `is:merged` as a qualifier and
 * `label:x` as another, so text typed into a search box could widen the very listing it is
 * meant to narrow — inside them it is only text.
 */
export function searchPhrase(query: string) {
  return `"${query.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

type ReferenceNode =
  | ReferenceCandidate
  | NonNullable<NonNullable<RepositoryReferences.Result["search"]["nodes"]>[number]>;

function toReferenceCandidate(node: ReferenceNode) {
  if (node.__typename === "Issue") {
    return {
      reference: `#${node.number}`,
      kind: "issue",
      number: node.number,
      title: node.title,
      state: node.issueState === "OPEN" ? "open" : "closed",
    } satisfies PullRequestReferenceCandidate | null;
  }
  if (node.__typename === "PullRequest") {
    return {
      reference: `#${node.number}`,
      kind: "change-request",
      number: node.number,
      title: node.title,
      state:
        node.pullRequestState === "OPEN"
          ? "open"
          : node.pullRequestState === "MERGED"
            ? "merged"
            : "closed",
    } satisfies PullRequestReferenceCandidate | null;
  }
  return null satisfies PullRequestReferenceCandidate | null;
}

export function toRepositoryReferences(result: RepositoryReferences.Result) {
  const exact = result.repository?.issueOrPullRequest;
  const nodes = [...(exact == null ? [] : [exact]), ...nodesOf(result.search)];
  return {
    items: nodes.flatMap((node) => {
      const candidate = toReferenceCandidate(node);
      return candidate === null ? [] : [candidate];
    }),
    truncated: result.search.pageInfo.hasNextPage,
  } satisfies {
    readonly items: ReadonlyArray<PullRequestReferenceCandidate>;
    readonly truncated: boolean;
  };
}

export function buildLabelRequest(labels: ReadonlyArray<string>) {
  return { labels };
}

export interface GitHubViewerAccess {
  readonly canWrite: boolean;
  readonly canDeleteBranch?: boolean;
  readonly canTriage: boolean;
  readonly canUpdate: boolean;
  readonly didAuthor: boolean;
  /**
   * GitHub's own `viewerCanUpdateBranch`, read with the base comparison rather than here: it is
   * false for a branch that is already current, so it answers "may update, and there is
   * something to update" at once. Absent where the comparison was not read.
   */
  readonly canUpdateBranch?: boolean;
  /** Detail-only readiness; omitted by the lightweight action permission read. */
  readonly canMergeNow?: boolean;
}

/** Null for a repository the viewer cannot see. */
export function toViewerPermissions(
  result: ViewerPermissions.Result,
): (GitHubViewerAccess & GitHubRepositoryAccess) | null;
export function toViewerPermissions(result: ViewerPermissions.Result) {
  const repository = result.repository;
  if (repository == null)
    return null satisfies (GitHubViewerAccess & GitHubRepositoryAccess) | null;
  return {
    mergeCapabilities: {
      merge: repository.mergeCommitAllowed,
      squash: repository.squashMergeAllowed,
      rebase: repository.rebaseMergeAllowed,
    },
    autoMergeAllowed: repository.autoMergeAllowed,
    canWrite: toCanWrite(repository.viewerPermission),
    canDeleteBranch: toCanWrite(repository.pullRequest?.headRepository?.viewerPermission),
    canTriage: toCanTriage(repository.viewerPermission),
    ...toPullRequestViewerFields(repository.pullRequest),
  } satisfies (GitHubViewerAccess & GitHubRepositoryAccess) | null;
}

export interface GitHubPullRequestFilesPatch {
  readonly patch: string;
  readonly truncated: boolean;
  readonly rawCount: number;
  readonly omittedFileStats: ReadonlyArray<PullRequestOmittedFileStat>;
}

/**
 * The files API returns hunks per file with no `diff --git` header, so the unified patch every
 * diff viewer expects is assembled here.
 */
export function decodePullRequestFilesJson(raw: string) {
  return Result.map(decodeUnknownList(raw), toFilesPatch);
}

export function decodeCommitFilesJson(raw: string) {
  return Result.map(decodeCommitFiles(raw), (commit) => toFilesPatch(commit.files ?? []));
}

const decodeCommitFiles = decodeJsonResult(
  Schema.Struct({ files: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))) }),
);

function toFilesPatch(entries: ReadonlyArray<unknown>) {
  const sections: string[] = [];
  const omittedFileStats: PullRequestOmittedFileStat[] = [];
  let truncated = false;
  for (const entry of entries) {
    const file = decodeFileEntry(entry);
    if (Exit.isFailure(file)) continue;
    const value = file.value;
    const hunks = value.patch ?? "";
    const status = value.status?.trim().toLowerCase();
    if (hunks.length === 0) {
      const additions = value.additions ?? 0;
      const deletions = value.deletions ?? 0;
      if (additions + deletions > 0) {
        truncated = true;
        omittedFileStats.push({ path: value.filename, additions, deletions });
      }
    }
    const oldPath =
      status === "renamed" ? value.previous_filename || value.filename : value.filename;
    const header = [
      `diff --git ${quoteGitPatchPath(`a/${oldPath}`)} ${quoteGitPatchPath(`b/${value.filename}`)}`,
      ...(status === "added" ? ["new file mode 100644"] : []),
      ...(status === "removed" ? ["deleted file mode 100644"] : []),
      ...(status === "renamed"
        ? [
            `similarity index ${hunks.length > 0 || (value.additions ?? 0) + (value.deletions ?? 0) > 0 ? 0 : 100}%`,
            `rename from ${quoteGitPatchPath(oldPath)}`,
            `rename to ${quoteGitPatchPath(value.filename)}`,
          ]
        : []),
      `--- ${status === "added" ? "/dev/null" : quoteGitPatchPath(`a/${oldPath}`)}`,
      `+++ ${status === "removed" ? "/dev/null" : quoteGitPatchPath(`b/${value.filename}`)}`,
    ].join("\n");
    sections.push(hunks.length === 0 ? `${header}\n` : `${header}\n${hunks.replace(/\n?$/, "\n")}`);
  }
  return {
    patch: sections.join(""),
    truncated,
    rawCount: entries.length,
    omittedFileStats,
  };
}

export interface GitHubPullRequestFilesViewedPage {
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly state: PullRequestFileViewedState;
  }>;
  readonly nextCursor: string | null;
}

function toFileViewedState(raw: string) {
  switch (raw.trim().toUpperCase()) {
    case "VIEWED":
      return "viewed";
    case "DISMISSED":
      return "dismissed";
    default:
      return "unviewed";
  }
}

/** One page of viewed state; empty for a pull request the host has nothing to say about. */
export function toPullRequestFilesViewedPage(
  result: PullRequestFilesViewed.Result,
): GitHubPullRequestFilesViewedPage;
export function toPullRequestFilesViewedPage(result: PullRequestFilesViewed.Result) {
  const files = result.repository?.pullRequest?.files;
  return {
    files: nodesOf(files).flatMap((node) =>
      node.path.length === 0
        ? []
        : [{ path: node.path, state: toFileViewedState(node.viewerViewedState) }],
    ),
    nextCursor: nextCursorOf(files?.pageInfo),
  } satisfies GitHubPullRequestFilesViewedPage;
}

export interface GitHubPullRequestFileStat {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface GitHubPullRequestFileStatsPage {
  readonly files: ReadonlyArray<GitHubPullRequestFileStat>;
  readonly nextCursor: string | null;
}

export function toPullRequestFileStatsPage(result: PullRequestFileStats.Result) {
  const files = result.repository?.pullRequest?.files;
  return {
    files: nodesOf(files).flatMap(({ path, additions, deletions }) =>
      path.length === 0 ? [] : [{ path, additions, deletions }],
    ),
    nextCursor: nextCursorOf(files?.pageInfo),
  };
}

const RawStackPullRequestSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  number: Schema.Int,
  head: Schema.Struct({ ref: Schema.String, sha: Schema.optional(Schema.String) }),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  merged_at: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawStackSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.Union([Schema.Int, Schema.String]))),
  number: Schema.Int,
  node_id: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.String,
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  base: Schema.Union([Schema.String, Schema.Struct({ ref: Schema.String })]),
  pull_requests: Schema.Array(RawStackPullRequestSchema),
});

const decodeStacks = decodeJsonResult(Schema.Array(RawStackSchema));

export interface GitHubPullRequestStackLayer {
  readonly title?: string;
  readonly isDraft?: boolean;
  readonly headSha?: string;
  readonly number: number;
  readonly headBranch: string;
  readonly state: PullRequestState;
}

export interface GitHubPullRequestStack {
  readonly id: string;
  readonly number: number;
  readonly url: string;
  readonly base: string;
  readonly layers: ReadonlyArray<GitHubPullRequestStackLayer>;
}

export function decodePullRequestStacksJson(
  raw: string,
): Result.Result<GitHubPullRequestStack | null, DecodeFailure>;
export function decodePullRequestStacksJson(raw: string) {
  const decoded = decodeStacks(raw);
  if (!Result.isSuccess(decoded))
    return Result.fail(decoded.failure) satisfies Result.Result<
      GitHubPullRequestStack | null,
      DecodeFailure
    >;
  const stack = decoded.success[0];
  if (stack === undefined)
    return Result.succeed(null) satisfies Result.Result<
      GitHubPullRequestStack | null,
      DecodeFailure
    >;
  return Result.succeed({
    id: stack.id == null ? (trimmed(stack.node_id) ?? String(stack.number)) : String(stack.id),
    number: stack.number,
    url: trimmed(stack.html_url) ?? stack.url,
    base: typeof stack.base === "string" ? stack.base : stack.base.ref,
    layers: stack.pull_requests.map((pullRequest) => ({
      ...(pullRequest.title === undefined ? {} : { title: pullRequest.title }),
      ...(pullRequest.draft === undefined ? {} : { isDraft: pullRequest.draft }),
      ...(pullRequest.head.sha === undefined ? {} : { headSha: pullRequest.head.sha }),
      number: pullRequest.number,
      headBranch: pullRequest.head.ref,
      state: toState({ state: pullRequest.state, mergedAt: pullRequest.merged_at }),
    })),
  }) satisfies Result.Result<GitHubPullRequestStack | null, DecodeFailure>;
}
