import { removeAgentCredits } from "@supaterm/source-control-core/server/mergeMessage";
import { SourceControlProviderKind } from "@supaterm/contracts";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type {
  PullRequestActor,
  PullRequestCapabilities,
  PullRequestReaction,
  PullRequestThreadComment,
} from "@supaterm/contracts";

import * as GitLabPullRequestCli from "./GitLabPullRequestCli.ts";
import type { GitLabDiffRefs, GitLabMergeRequestListState } from "./gitLabMergeRequestJson.ts";
import {
  PullRequestProviderError,
  type PullRequestProviderFailure,
  type PullRequestProviderApi,
} from "@supaterm/source-control-core/server/PullRequestProvider";
import { definition } from "../shared/definition.ts";

const CAPABILITIES: PullRequestCapabilities = {
  diff: true,
  comment: true,
  actions: [...definition.changeRequestActions],
  mergeMethods: ["merge", "squash", "rebase"],
  deleteBranch: true,
  updateMethods: ["rebase"],
  search: true,
  reactions: true,
  mentions: true,
  referenceSigils: ["#", "!"],
  viewedFiles: "environment",
  review: {
    inlineComment: true,
    rangeComment: true,
    reply: true,
    resolve: true,
    verdicts: ["comment", "approve", "request-changes"],
  },
  reviewers: { request: true, listCandidates: true, searchCandidates: true },
  labels: true,
  edit: { changeRequest: true, comment: true, maintainerEdits: true },
  withheldFileDiff: true,
};

const UNAVAILABLE_REQUIREMENT = {
  missing:
    "GitLab CLI (`glab`) is required to browse change requests on this host. Install it from https://gitlab.com/gitlab-org/cli and reload.",
  unauthenticated: "GitLab CLI is not authenticated. Run `glab auth login` and retry.",
};

const MERGE_ACTIONS: ReadonlySet<string> = new Set([
  "merge",
  "update-branch",
  "enable-auto-merge",
  "disable-auto-merge",
  "revert",
]);

/** Authors may close/reopen/change draft state regardless of role; REST omits authorship. */
export function gitLabViewerPermissions(input: {
  readonly viewerCanMerge: boolean;
  readonly viewerCanEditMaintainerEdits?: boolean | undefined;
  readonly viewerCanDeleteBranch?: boolean;
  readonly viewerCanEditLabels?: boolean | undefined;
}) {
  return {
    ...(input.viewerCanDeleteBranch === true ? { deleteBranch: true } : {}),
    actions: CAPABILITIES.actions.filter(
      (action) => !MERGE_ACTIONS.has(action) || input.viewerCanMerge,
    ),
    comment: true,
    resolve: true,
    verdicts: CAPABILITIES.review.verdicts,
    requestReviewers: true,
    maintainerEdits: input.viewerCanEditMaintainerEdits === true,
    labels: input.viewerCanEditLabels === true,
    ...(input.viewerCanMerge ? { updateMethods: CAPABILITIES.updateMethods } : {}),
  };
}

const MERGE_REQUEST_DETAIL_TTL = Duration.minutes(1);
const PROJECT_MERGE_CAPABILITIES_TTL = Duration.minutes(15);
const READ_CACHE_CAPACITY = 256;
const GRAPHQL_LIST_SUPPORT_TTL = Duration.hours(1);

function gitLabProviderFailure(error: GitLabPullRequestCli.GitLabPullRequestCliError) {
  if (error._tag === "GitLabCliUnavailableError")
    return { reason: "missing-tool" } satisfies PullRequestProviderFailure;
  if (error._tag === "GitLabCliAuthenticationError")
    return { reason: "unauthenticated" } satisfies PullRequestProviderFailure;
  if (error._tag === "GitLabCliRateLimitError")
    return { reason: "rate-limited" } satisfies PullRequestProviderFailure;
  if (error._tag === "GitLabMergeRequestNotFoundError")
    return { reason: "not-found" } satisfies PullRequestProviderFailure;
  return { reason: "failed" } satisfies PullRequestProviderFailure;
}

const isOutdated = (thread: GitLabDiffRefs | undefined, current: GitLabDiffRefs | undefined) =>
  thread !== undefined &&
  current !== undefined &&
  (thread.baseSha !== current.baseSha ||
    thread.startSha !== current.startSha ||
    thread.headSha !== current.headSha);

export const make = Effect.gen(function* () {
  const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;

  const mergeRequestDetails = yield* Cache.makeWith(
    (key: string) => {
      const [cwd, repository, number, host] = JSON.parse(key) as [string, string, number, string];
      return cli.getMergeRequestDetail({ cwd, repository, number, host });
    },
    {
      capacity: READ_CACHE_CAPACITY,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? MERGE_REQUEST_DETAIL_TTL : Duration.zero),
    },
  );
  const graphqlListSupport = yield* Cache.makeWith(
    (key: string) => {
      const [cwd, host] = JSON.parse(key) as [string, string | undefined];
      return cli.supportsGraphqlList({ cwd, host }).pipe(
        Effect.catchIf(
          (cause) =>
            cause._tag !== "GitLabCliUnavailableError" &&
            cause._tag !== "GitLabCliAuthenticationError" &&
            cause._tag !== "GitLabCliRateLimitError",
          () => Effect.succeed(false),
        ),
      );
    },
    {
      capacity: READ_CACHE_CAPACITY,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? GRAPHQL_LIST_SUPPORT_TTL : Duration.zero),
    },
  );
  const projectMergeCapabilities = yield* Cache.makeWith(
    (key: string) => {
      const [cwd, repository, host] = JSON.parse(key) as [string, string, string];
      return cli.getProjectMergeCapabilities({ cwd, repository, host });
    },
    {
      capacity: READ_CACHE_CAPACITY,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? PROJECT_MERGE_CAPABILITIES_TTL : Duration.zero),
    },
  );

  const detailKey = (input: {
    readonly cwd: string;
    readonly host: string;
    readonly repository: string;
    readonly number: number;
  }) => JSON.stringify([input.cwd, input.repository, input.number, input.host]);
  const mergeRequestDetail = (input: {
    readonly cwd: string;
    readonly host: string;
    readonly repository: string;
    readonly number: number;
  }) => Cache.get(mergeRequestDetails, detailKey(input));

  const writing =
    <
      I extends {
        readonly cwd: string;
        readonly host: string;
        readonly repository: string;
        readonly number: number;
      },
      A,
      E,
    >(
      write: (input: I) => Effect.Effect<A, E>,
    ) =>
    (input: I) => {
      const invalidate = Cache.invalidate(mergeRequestDetails, detailKey(input));
      return invalidate.pipe(Effect.andThen(write(input)), Effect.ensuring(invalidate));
    };

  const fail = (operation: string) => (error: GitLabPullRequestCli.GitLabPullRequestCliError) =>
    new PullRequestProviderError({
      provider: SourceControlProviderKind.make("gitlab"),
      operation,
      ...gitLabProviderFailure(error),
      detail: error.detail,
      cause: error,
    });

  const recoverRead = <A>(
    read: Effect.Effect<A, GitLabPullRequestCli.GitLabPullRequestCliError>,
    fallback: A,
  ) =>
    read.pipe(
      Effect.catch((error) => {
        const { reason } = gitLabProviderFailure(error);
        return reason === "rate-limited" ||
          reason === "unauthenticated" ||
          reason === "missing-tool"
          ? Effect.fail(error)
          : Effect.succeed(fallback);
      }),
    );

  const listStates = (input: Parameters<typeof cli.getListStates>[0]) =>
    cli.getListStates(input).pipe(
      Effect.catch((error) =>
        Effect.logWarning("GitLab merge request approval and pipeline read failed", {
          repository: input.repository,
          reason: error._tag,
        }).pipe(Effect.as<ReadonlyMap<number, GitLabMergeRequestListState>>(new Map())),
      ),
    );

  const mergeRequestWithStats = (
    input: {
      readonly cwd: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
    },
    detail = cli.getMergeRequestDetail(input),
  ) =>
    Effect.all(
      [
        detail,
        cli.listMergeRequestStats({ cwd: input.cwd, host: input.host, changeRequests: [input] }),
      ],
      {
        concurrency: 2,
      },
    ).pipe(
      Effect.map(([mergeRequest, [stat]]) =>
        stat === undefined
          ? mergeRequest
          : { ...mergeRequest, additions: stat.additions, deletions: stat.deletions },
      ),
    );

  const provider: PullRequestProviderApi = {
    kind: SourceControlProviderKind.make("gitlab"),
    capabilities: CAPABILITIES,
    mergeMessageRewrite: removeAgentCredits,
    unavailableRequirement: UNAVAILABLE_REQUIREMENT,

    getViewer: (input) => cli.getViewerUsername(input).pipe(Effect.mapError(fail("getViewer"))),

    listChangeRequests: (input) =>
      Cache.get(graphqlListSupport, JSON.stringify([input.cwd, input.host])).pipe(
        Effect.orElseSucceed(() => false),
        Effect.flatMap((graphql) =>
          cli.listMergeRequests({
            cwd: input.cwd,
            host: input.host,
            repository: input.repository,
            state: input.state,
            involvement: input.involvement,
            viewer: input.viewer,
            limit: input.limit,
            query: input.query,
            cursor: input.cursor,
            filters: input.filters,
            graphql,
          }),
        ),
        Effect.flatMap(({ listStates: carried, ...batch }) =>
          (carried === undefined
            ? listStates({
                cwd: input.cwd,
                host: input.host,
                repository: input.repository,
                numbers: batch.items.map((item) => item.number),
              })
            : Effect.succeed(carried)
          ).pipe(
            Effect.map((states) => ({
              ...batch,
              items: batch.items.map((item) => withListState(item, states)),
              continues: true,
            })),
          ),
        ),
        Effect.mapError(fail("listChangeRequests")),
      ),

    getFileStats: (input) =>
      cli.getMergeRequestFileStats(input).pipe(Effect.mapError(fail("getFileStats"))),

    listChangeRequestStats: (input) =>
      cli.listMergeRequestStats(input).pipe(Effect.mapError(fail("listChangeRequestStats"))),

    getChangeRequestChecks: (input) =>
      mergeRequestDetail(input).pipe(
        Effect.map(({ state, checks }) => ({ state, checks })),
        Effect.mapError(fail("getChangeRequestChecks")),
      ),

    getChangeRequestPreview: (input) =>
      cli
        .getMergeRequestDetail({ ...input, maintainerEdits: false })
        .pipe(Effect.mapError(fail("getChangeRequestPreview"))),

    getChangeRequestSummary: (input) =>
      Effect.all(
        [
          mergeRequestWithStats(
            input,
            cli.getMergeRequestDetail({ ...input, maintainerEdits: false }),
          ),
          listStates({
            cwd: input.cwd,
            host: input.host,
            repository: input.repository,
            numbers: [input.number],
          }),
        ],
        { concurrency: 2 },
      ).pipe(
        Effect.map(([mergeRequest, states]) => withListState(mergeRequest, states)),
        Effect.mapError(fail("getChangeRequestSummary")),
      ),

    getChangeRequest: (input) =>
      Effect.all(
        [
          mergeRequestWithStats(input, mergeRequestDetail(input)),
          Cache.get(
            projectMergeCapabilities,
            JSON.stringify([input.cwd, input.repository, input.host]),
          ),
        ],
        { concurrency: 2 },
      ).pipe(
        Effect.mapError(fail("getChangeRequest")),
        Effect.map(([mergeRequest, mergeCapabilities]) => ({
          ...mergeRequest,
          mergeCapabilities,
          viewerPermissions: gitLabViewerPermissions(mergeRequest),
          baseComparison:
            mergeRequest.divergedCommits === undefined
              ? "unknown"
              : mergeRequest.divergedCommits > 0
                ? "behind"
                : "up-to-date",
          ...(mergeRequest.divergedCommits === undefined
            ? {}
            : { behindBy: mergeRequest.divergedCommits }),
        })),
      ),

    getChangeRequestWatchFingerprint: (input) =>
      cli
        .getMergeRequestWatchFingerprint(input)
        .pipe(Effect.mapError(fail("getChangeRequestWatchFingerprint"))),

    getChangeRequestActivity: (input) =>
      Effect.all(
        [
          recoverRead(cli.listNotes(input), { comments: [], truncated: true }),
          recoverRead(cli.listCommits(input), []),
          recoverRead(cli.listDiscussions(input), {
            threads: [],
            diffRefsByThreadId: new Map(),
            overviewFindingIds: [],
            truncated: true,
          }),
          recoverRead(cli.listReactions(input), {
            reactions: [] as ReadonlyArray<PullRequestReaction>,
            reactionsByNoteId: new Map<string, ReadonlyArray<PullRequestReaction>>(),
            editedAtByNoteId: new Map<string, string>(),
            botLogins: new Set<string>(),
          }),
          recoverRead(
            cli.getMergeRequestDetail({ ...input, downstreamChecks: false }).pipe(
              Effect.map((mergeRequest) => ({
                url: mergeRequest.url,
                diffRefs: mergeRequest.diffRefs,
              })),
            ),
            null,
          ),
        ],
        { concurrency: 5 },
      ).pipe(
        Effect.mapError(fail("getChangeRequestActivity")),
        Effect.map(([notes, commits, discussions, awards, detail]) => {
          const noteUrl = (id: string) => (detail === null ? null : `${detail.url}#note_${id}`);
          const findingIds = new Set(discussions.overviewFindingIds);
          const edited = (id: string) => {
            const editedAt = awards.editedAtByNoteId.get(id);
            return editedAt === undefined ? {} : { editedAt };
          };
          const botLogins = new Set([...awards.botLogins].map((login) => login.toLowerCase()));
          const withBotFlag = (author: PullRequestActor | null) =>
            author !== null && botLogins.has(author.login.toLowerCase())
              ? { ...author, isBot: true }
              : author;
          const withNoteDetails = (comment: PullRequestThreadComment) => ({
            ...comment,
            ...edited(comment.id),
            author: withBotFlag(comment.author),
            url: noteUrl(comment.id),
            reactions: awards.reactionsByNoteId.get(comment.id) ?? [],
          });
          return {
            reactions: awards.reactions,
            comments: notes.comments.map((comment) => ({
              ...comment,
              ...(findingIds.has(comment.id) ? { kind: "review-comment" as const } : {}),
              ...edited(comment.id),
              author: withBotFlag(comment.author),
              url: noteUrl(comment.id),
              reactions: awards.reactionsByNoteId.get(comment.id) ?? [],
            })),
            commentCount: notes.comments.length,
            commentsTruncated: notes.truncated || discussions.truncated,
            reviewThreads: discussions.threads.flatMap((thread) =>
              thread.path === null
                ? []
                : [
                    {
                      ...thread,
                      isOutdated: isOutdated(
                        discussions.diffRefsByThreadId.get(thread.id),
                        detail?.diffRefs,
                      ),
                      comments: thread.comments.map(withNoteDetails),
                    },
                  ],
            ),
            overviewThreads: discussions.threads.flatMap((thread) =>
              thread.path === null
                ? [{ ...thread, comments: thread.comments.map(withNoteDetails) }]
                : [],
            ),
            commits,
          };
        }),
      ),

    getViewerPermissions: (input) =>
      cli
        .getMergeRequestDetail({ ...input, downstreamChecks: false })
        .pipe(Effect.mapError(fail("getViewerPermissions")), Effect.map(gitLabViewerPermissions)),

    forgetChangeRequestReads: (scope) =>
      Cache.keys(mergeRequestDetails).pipe(
        Effect.flatMap((keys) =>
          Effect.forEach(
            Array.from(keys).filter((key) => {
              if (scope === undefined) return true;
              const [, repository, number] = JSON.parse(key) as [string, string, number];
              return (
                repository.toLowerCase() === scope.repository.toLowerCase() &&
                (scope.number === undefined || number === scope.number)
              );
            }),
            (key) => Cache.invalidate(mergeRequestDetails, key),
            { discard: true },
          ),
        ),
      ),

    getDiff: (input) => cli.getMergeRequestDiff(input).pipe(Effect.mapError(fail("getDiff"))),

    getDiffFileContents: (input) =>
      cli.getMergeRequestDiffFileContents(input).pipe(Effect.mapError(fail("getDiffFileContents"))),

    getFileRevisions: (input) =>
      cli.getFileRevisions(input).pipe(
        Effect.mapError(fail("getFileRevisions")),
        Effect.map((revisions) => ({ revisions })),
      ),

    listReviewerCandidates: (input) =>
      cli
        .listReviewerCandidates({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          query: input.query,
        })
        .pipe(Effect.mapError(fail("listReviewerCandidates"))),

    listLabelCandidates: (input) =>
      cli
        .listLabelCandidates({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
        })
        .pipe(Effect.mapError(fail("listLabelCandidates"))),

    setLabels: writing((input) =>
      cli
        .setLabels({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          labels: input.labels,
          applied: input.applied,
        })
        .pipe(Effect.mapError(fail("setLabels"))),
    ),

    listRepositoryLabels: (input) =>
      cli
        .listProjectLabels({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          search: input.query,
        })
        .pipe(Effect.mapError(fail("listRepositoryLabels"))),

    searchRepositoryAuthors: (input) =>
      cli
        .listProjectUsers({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          search: input.query,
        })
        .pipe(Effect.mapError(fail("searchRepositoryAuthors"))),

    searchRepositoryReferences: (input) =>
      cli
        .searchProjectReferences({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          search: input.query,
          sigil: input.sigil,
        })
        .pipe(Effect.mapError(fail("searchRepositoryReferences"))),

    setReviewerRequest: writing((input) =>
      cli
        .setReviewerRequest({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          reviewers: input.reviewers,
          requested: input.requested,
        })
        .pipe(Effect.mapError(fail("setReviewerRequest"))),
    ),

    runAction: writing((input) =>
      cli
        .runMergeRequestAction({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          action: input.action,
          ...(input.mergeMethod === undefined ? {} : { mergeMethod: input.mergeMethod }),
          ...(input.removeAgentCreditsOnMerge === true ? { removeAgentCreditsOnMerge: true } : {}),
        })
        .pipe(Effect.mapError(fail("runAction"))),
    ),

    updateChangeRequest: writing((input) =>
      cli
        .updateMergeRequest({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { description: input.body }),
          ...(input.maintainerCanModify === undefined
            ? {}
            : { allowCollaboration: input.maintainerCanModify }),
        })
        .pipe(Effect.mapError(fail("updateChangeRequest"))),
    ),

    comment: writing((input) =>
      cli.commentOnMergeRequest(input).pipe(Effect.mapError(fail("comment"))),
    ),

    updateComment: writing((input) =>
      cli
        .updateNote({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          noteId: input.commentId,
          body: input.body,
        })
        .pipe(Effect.mapError(fail("updateComment"))),
    ),

    submitReview: writing((input) =>
      cli.submitReview(input).pipe(Effect.mapError(fail("submitReview"))),
    ),

    replyToThread: writing((input) =>
      cli
        .replyToDiscussion({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          discussionId: input.threadId,
          body: input.body,
        })
        .pipe(Effect.mapError(fail("replyToThread"))),
    ),

    setReaction: writing((input) =>
      cli
        .setReaction({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          ...(input.subjectId === undefined ? {} : { noteId: input.subjectId }),
          content: input.content,
          reacted: input.reacted,
        })
        .pipe(Effect.mapError(fail("setReaction"))),
    ),

    setThreadResolution: writing((input) =>
      cli
        .setDiscussionResolution({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          discussionId: input.threadId,
          resolved: input.resolved,
        })
        .pipe(Effect.mapError(fail("setThreadResolution"))),
    ),
  };

  return provider;
});

function withListState<Item extends { readonly number: number }>(
  item: Item,
  states: ReadonlyMap<number, GitLabMergeRequestListState>,
) {
  const state = states.get(item.number);
  return state === undefined ? item : { ...item, ...state };
}
