import {
  McpCapabilityUnavailableError,
  OrchestratorMcpFailure,
  PositiveInt,
  PullRequestCheckStatus,
  PullRequestReviewGuide,
  PullRequestReviewGuideRun,
  PullRequestState,
  ThreadPullRequestLinkSource,
  TrimmedNonEmptyString,
  ThreadId,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as PullRequestReviewGuideService from "../../../pullRequest/PullRequestReviewGuideService.ts";
import * as PullRequestService from "../../../pullRequest/PullRequestService.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  Orchestrator.OrchestratorV2,
  ProjectService.ProjectService,
];

const workflowRunDependencies = [...dependencies, PullRequestService.PullRequestService];

const guideDependencies = [
  ...dependencies,
  PullRequestReviewGuideService.PullRequestReviewGuideService,
];

const REGISTER_EVERY_PR =
  "Register every pull request you open for this thread, including each layer of a stack, right after creating it.";

export const PullRequestTargetInput = Schema.Struct({
  threadId: Schema.optional(
    ThreadId.annotate({
      description: "Thread to act on. Omit for this thread.",
    }),
  ),
  url: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "The pull request's web URL as its host shows it, for example https://git.example.com/owner/repo/pull/123 or https://git.example.com/group/project/-/merge_requests/123. Preferred when you have it; host, repository and number are read from it.",
    }),
  ),
  repository: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Repository path below the host, for example owner/repo. Required with number when url is omitted.",
    }),
  ),
  number: Schema.optional(
    PositiveInt.annotate({
      description: "Pull request number. Required with repository when url is omitted.",
    }),
  ),
  host: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Host the repository lives on, for example git.example.com. Defaults to the host of this thread's project.",
    }),
  ),
});
export type PullRequestTargetInput = typeof PullRequestTargetInput.Type;

/** Either the run's URL or its id, the way `gh run list` shows it. */
export const WorkflowRunTargetInput = Schema.Struct({
  threadId: PullRequestTargetInput.fields.threadId,
  url: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "The run's web URL, for example https://github.com/owner/repo/actions/runs/123. Preferred when you have it; host, repository and run id are read from it.",
    }),
  ),
  runId: Schema.optional(
    PositiveInt.annotate({
      description: "The run's id. Required when url is omitted.",
    }),
  ),
  repository: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "owner/repo, when the run is not in the repository `gh` picks in this thread's checkout.",
    }),
  ),
  host: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "Host the repository lives on. Defaults to the host of this thread's project.",
    }),
  ),
});
export type WorkflowRunTargetInput = typeof WorkflowRunTargetInput.Type;

export class WorkflowRunTargetInvalidError extends Schema.TaggedError<WorkflowRunTargetInvalidError>()(
  "WorkflowRunTargetInvalidError",
  {},
) {
  override get message(): string {
    return "Pass the run's URL (https://github.com/owner/repo/actions/runs/<id>), or its runId.";
  }
}

export class WorkflowRunUnreadableError extends Schema.TaggedError<WorkflowRunUnreadableError>()(
  "WorkflowRunUnreadableError",
  { detail: Schema.String },
) {
  override get message(): string {
    return `Could not read the workflow run: ${this.detail}`;
  }
}

export class WorkflowRunWatchFailedError extends Schema.TaggedError<WorkflowRunWatchFailedError>()(
  "WorkflowRunWatchFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not change whether the workflow run is watched.";
  }
}

export class WorkflowRunWatchFromSubagentError extends Schema.TaggedError<WorkflowRunWatchFromSubagentError>()(
  "WorkflowRunWatchFromSubagentError",
  {},
) {
  override get message(): string {
    return "This thread is a subagent, so it cannot watch workflow runs. Finish your task and report back to the parent thread instead.";
  }
}

export class PullRequestUrlInvalidError extends Schema.TaggedError<PullRequestUrlInvalidError>()(
  "PullRequestUrlInvalidError",
  {},
) {
  override get message(): string {
    return "This is not a recognised pull request URL. Pass repository and number instead.";
  }
}

export class PullRequestTargetIncompleteError extends Schema.TaggedError<PullRequestTargetIncompleteError>()(
  "PullRequestTargetIncompleteError",
  {},
) {
  override get message(): string {
    return "Pass either url, or both repository and number.";
  }
}

export class PullRequestHostRequiredError extends Schema.TaggedError<PullRequestHostRequiredError>()(
  "PullRequestHostRequiredError",
  {},
) {
  override get message(): string {
    return "This thread's project has no recognised remote. Pass host or url.";
  }
}

export class PullRequestUrlUnavailableError extends Schema.TaggedError<PullRequestUrlUnavailableError>()(
  "PullRequestUrlUnavailableError",
  {},
) {
  override get message(): string {
    return "This thread's project is on a host with no known pull request URL shape. Pass url.";
  }
}

export class PullRequestThreadRequiredError extends Schema.TaggedError<PullRequestThreadRequiredError>()(
  "PullRequestThreadRequiredError",
  {},
) {
  override get message(): string {
    return "Pass threadId: this MCP client is not running inside a Supaterm thread.";
  }
}

export class PullRequestThreadNotFoundError extends Schema.TaggedError<PullRequestThreadNotFoundError>()(
  "PullRequestThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export class PullRequestLinkFailedError extends Schema.TaggedError<PullRequestLinkFailedError>()(
  "PullRequestLinkFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not link the pull request.";
  }
}

export class PullRequestUnlinkFailedError extends Schema.TaggedError<PullRequestUnlinkFailedError>()(
  "PullRequestUnlinkFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not unlink the pull request.";
  }
}

export class PullRequestWatchFailedError extends Schema.TaggedError<PullRequestWatchFailedError>()(
  "PullRequestWatchFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not change whether the pull request is watched.";
  }
}

export class PullRequestNotOpenError extends Schema.TaggedError<PullRequestNotOpenError>()(
  "PullRequestNotOpenError",
  { state: Schema.String },
) {
  override get message(): string {
    return `The pull request is ${this.state}, so there is nothing to watch.`;
  }
}

export class PullRequestWatchFromSubagentError extends Schema.TaggedError<PullRequestWatchFromSubagentError>()(
  "PullRequestWatchFromSubagentError",
  {},
) {
  override get message(): string {
    return "This thread is a subagent, so it cannot watch pull requests. Its parent thread owns the pull request: finish your task and report back instead.";
  }
}

export class PullRequestListFailedError extends Schema.TaggedError<PullRequestListFailedError>()(
  "PullRequestListFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not list the pull request.";
  }
}

export class PullRequestProjectNotFoundError extends Schema.TaggedError<PullRequestProjectNotFoundError>()(
  "PullRequestProjectNotFoundError",
  { repository: Schema.String },
) {
  override get message(): string {
    return `No project in this environment is a checkout of ${this.repository}, so its pull requests cannot be read here. Add one with supaterm_project_create.`;
  }
}

export class PullRequestGuideFailedError extends Schema.TaggedError<PullRequestGuideFailedError>()(
  "PullRequestGuideFailedError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}

export const PullRequestToolError = Schema.Union([
  OrchestratorMcpFailure,
  McpCapabilityUnavailableError,
  PullRequestUrlInvalidError,
  PullRequestTargetIncompleteError,
  PullRequestHostRequiredError,
  PullRequestUrlUnavailableError,
  PullRequestThreadRequiredError,
  PullRequestThreadNotFoundError,
  PullRequestLinkFailedError,
  PullRequestUnlinkFailedError,
  PullRequestListFailedError,
  PullRequestWatchFailedError,
  PullRequestNotOpenError,
  PullRequestWatchFromSubagentError,
  PullRequestProjectNotFoundError,
  PullRequestGuideFailedError,
  WorkflowRunTargetInvalidError,
  WorkflowRunUnreadableError,
  WorkflowRunWatchFailedError,
  WorkflowRunWatchFromSubagentError,
]);
export type PullRequestToolError = typeof PullRequestToolError.Type;

const PullRequestIdentity = {
  host: Schema.String,
  repository: Schema.String,
  number: Schema.Int,
  url: Schema.String,
};

export const LinkPullRequestResult = Schema.Struct({
  ...PullRequestIdentity,
  alreadyLinked: Schema.Boolean.annotate({
    description: "True when the pull request was linked to this thread before the call.",
  }),
});
export type LinkPullRequestResult = typeof LinkPullRequestResult.Type;

export const UnlinkPullRequestResult = Schema.Struct({
  host: Schema.String,
  repository: Schema.String,
  number: Schema.Int,
  wasLinked: Schema.Boolean.annotate({
    description: "False when the pull request was not linked to this thread to begin with.",
  }),
});
export type UnlinkPullRequestResult = typeof UnlinkPullRequestResult.Type;

export const WatchPullRequestResult = Schema.Struct({
  ...PullRequestIdentity,
  watching: Schema.Boolean.annotate({
    description: "Whether Supaterm now watches the pull request for this thread.",
  }),
  wasWatching: Schema.Boolean.annotate({
    description: "Whether it was already watched before the call.",
  }),
});
export type WatchPullRequestResult = typeof WatchPullRequestResult.Type;

export const WatchWorkflowRunResult = Schema.Struct({
  host: Schema.String,
  repository: Schema.String,
  runId: Schema.Int,
  name: Schema.String,
  url: Schema.NullOr(Schema.String),
  status: PullRequestCheckStatus.annotate({
    description:
      "The run's verdict as read now: pending while it runs. A run that already completed is not watched.",
  }),
  watching: Schema.Boolean.annotate({
    description: "Whether Supaterm now watches the run for this thread.",
  }),
  wasWatching: Schema.Boolean.annotate({
    description: "Whether it was already watched before the call.",
  }),
});
export type WatchWorkflowRunResult = typeof WatchWorkflowRunResult.Type;

export const UnwatchWorkflowRunResult = Schema.Struct({
  host: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  runId: Schema.Int,
  watching: Schema.Boolean,
  wasWatching: Schema.Boolean.annotate({
    description: "False when the run was not watched for this thread to begin with.",
  }),
});
export type UnwatchWorkflowRunResult = typeof UnwatchWorkflowRunResult.Type;

export const ThreadPullRequestEntry = Schema.Struct({
  ...PullRequestIdentity,
  source: ThreadPullRequestLinkSource,
  watching: Schema.Boolean,
  state: Schema.NullOr(PullRequestState),
  title: Schema.NullOr(Schema.String),
  headBranch: Schema.NullOr(Schema.String),
  baseBranch: Schema.NullOr(Schema.String),
  isDraft: Schema.NullOr(Schema.Boolean),
  stack: Schema.NullOr(
    Schema.Struct({
      kind: Schema.Literals(["native", "derived"]),
      /** 1-based layer from the bottom; siblings share a layer. */
      position: Schema.Int,
      size: Schema.Int,
    }),
  ),
});
export type ThreadPullRequestEntry = typeof ThreadPullRequestEntry.Type;

export const ListThreadPullRequestsResult = Schema.Struct({
  pullRequests: Schema.Array(ThreadPullRequestEntry),
  chains: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["native", "derived"]),
      /** Bottom to top; each pull request comes before the ones built on it. */
      numbers: Schema.Array(Schema.Int),
    }),
  ),
});
export type ListThreadPullRequestsResult = typeof ListThreadPullRequestsResult.Type;

const LinkPullRequestTool = Tool.make("link_pull_request", {
  description: `${REGISTER_EVERY_PR} Links a pull request to this thread so Supaterm tracks it, shows its status beside the thread, and can mark the thread as done when it merges if automatic completion of merged threads is enabled. Pass the URL, or repository plus number. Linking an already-linked pull request succeeds with alreadyLinked=true.`,
  parameters: PullRequestTargetInput,
  success: LinkPullRequestResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "Link pull request to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UnlinkPullRequestTool = Tool.make("unlink_pull_request", {
  description:
    "Remove a pull request link from this thread, for example after closing a pull request you opened by mistake. Pass the URL, or repository plus number. Unlinking a pull request that is not linked succeeds with wasLinked=false.",
  parameters: PullRequestTargetInput,
  success: UnlinkPullRequestResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unlink pull request from thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ListThreadPullRequestsTool = Tool.make("list_thread_pull_requests", {
  description: `List the pull requests linked to a thread (omit threadId for this thread) with their last known host state, and how they chain into stacks (bottom to top). ${REGISTER_EVERY_PR}`,
  parameters: Schema.Struct({
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Thread to list. Omit for this thread." }),
    ),
  }),
  success: ListThreadPullRequestsResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "List thread pull requests")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const WatchPullRequestTool = Tool.make("watch_pull_request", {
  description:
    "Have Supaterm watch an open pull request for this thread, linking it first if needed. Supaterm checks it every two minutes and wakes you with a message when a check fails, the required checks pass, someone else comments or reviews, or the branch starts to conflict with its base. Use this to monitor or babysit a pull request instead of polling, sleeping, or running a watcher. Only comments posted after this call wake you, so handle the existing ones first, then end your turn. A wake is news, not a merge decision: check readiness yourself before merging. While Supaterm watches, the thread stays in the user's Working list, not their inbox. When you hand the work back to the user, call unwatch_pull_request first so the thread returns to their inbox. Watching ends when the pull request merges or closes, when its thread is marked done or archived, when Supaterm fails to read it 8 times in a row (a host rate limit only delays it), when the user stops this thread, or when you call unwatch_pull_request. Reopen the thread before starting a new watch. A subagent cannot watch: its parent thread owns the pull request.",
  parameters: PullRequestTargetInput,
  success: WatchPullRequestResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "Watch pull request")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UnwatchPullRequestTool = Tool.make("unwatch_pull_request", {
  description:
    "Stop Supaterm from watching a pull request for this thread. The pull request stays linked. Pass the URL, or repository plus number.",
  parameters: PullRequestTargetInput,
  success: WatchPullRequestResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "Stop watching pull request")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const WatchWorkflowRunTool = Tool.make("watch_workflow_run", {
  description:
    "Have Supaterm watch a GitHub Actions workflow run for this thread and wake you once, when it completes, with every job that did not pass. Use this to wait on CI, a release or a deploy instead of `gh run watch`, a sleep loop, or a background watcher, then end your turn. Pass the run's URL, or its id (from `gh run list`). A run that already completed is not watched: the result's status says how it ended. While Supaterm watches, the thread stays in the user's Working list, not their inbox. Watching ends when the run completes, after six hours, when the thread is marked done or archived, when Supaterm fails to read the run 8 times in a row (a host rate limit only delays it), when the user stops this thread, or when you call unwatch_workflow_run. A subagent cannot watch: its parent thread owns the run.",
  parameters: WorkflowRunTargetInput,
  success: WatchWorkflowRunResult,
  failure: PullRequestToolError,
  dependencies: workflowRunDependencies,
})
  .annotate(Tool.Title, "Watch workflow run")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UnwatchWorkflowRunTool = Tool.make("unwatch_workflow_run", {
  description:
    "Stop Supaterm from watching a workflow run for this thread. Pass the run's URL, or its id.",
  parameters: WorkflowRunTargetInput,
  success: UnwatchWorkflowRunResult,
  failure: PullRequestToolError,
  dependencies: workflowRunDependencies,
})
  .annotate(Tool.Title, "Stop watching workflow run")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GuideTarget = Schema.Struct({
  url: PullRequestTargetInput.fields.url,
  repository: PullRequestTargetInput.fields.repository,
  number: PullRequestTargetInput.fields.number,
  host: PullRequestTargetInput.fields.host,
});

const GuideOutcome = Schema.Struct({
  ...PullRequestIdentity,
  outcome: Schema.Literals(["started", "running", "failed"]).annotate({
    description:
      "started: a run began. running: one was already going for this head and the call joined it. failed: this pull request could not be guided; see detail.",
  }),
  detail: Schema.NullOr(Schema.String),
});

export const WritePullRequestGuidesResult = Schema.Struct({
  guides: Schema.Array(GuideOutcome),
});
export type WritePullRequestGuidesResult = typeof WritePullRequestGuidesResult.Type;

export const ReadPullRequestGuideResult = Schema.Struct({
  ...PullRequestIdentity,
  guide: Schema.NullOr(PullRequestReviewGuide),
  run: Schema.NullOr(PullRequestReviewGuideRun),
  currentHeadSha: Schema.NullOr(Schema.String),
  stale: Schema.Boolean.annotate({
    description:
      "True when the guide was written for an earlier head than the pull request has now.",
  }),
});
export type ReadPullRequestGuideResult = typeof ReadPullRequestGuideResult.Type;

const WritePullRequestGuidesTool = Tool.make("write_pull_request_guides", {
  description:
    "Write review guides for up to 20 pull requests, the tour a maintainer reads in a pull request's Guide tab. Each run reads its change in a temporary checkout and takes minutes, so this returns once the runs are under way; read a guide with read_pull_request_guide to see when it is written. A guide for the same head that is already running is joined, not restarted; a pull request whose guide is current is written again. Each pull request is read through the project in this environment whose checkout has that repository. Fails while review guides are off on this server.",
  parameters: Schema.Struct({
    pullRequests: Schema.Array(GuideTarget).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  }),
  success: WritePullRequestGuidesResult,
  failure: PullRequestToolError,
  dependencies: guideDependencies,
})
  .annotate(Tool.Title, "Write pull request guides")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const ReadPullRequestGuideTool = Tool.make("read_pull_request_guide", {
  description:
    "Read a pull request's stored review guide and its run: run.Running while one is being written, run.Failed with the reason when the last one failed, guide null when none was written. stale is true after a push the guide has not caught up with. Never starts a run.",
  parameters: GuideTarget,
  success: ReadPullRequestGuideResult,
  failure: PullRequestToolError,
  dependencies: guideDependencies,
})
  .annotate(Tool.Title, "Read pull request guide")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const PullRequestsToolkit = Toolkit.make(
  LinkPullRequestTool,
  UnlinkPullRequestTool,
  ListThreadPullRequestsTool,
  WatchPullRequestTool,
  UnwatchPullRequestTool,
  WatchWorkflowRunTool,
  UnwatchWorkflowRunTool,
  WritePullRequestGuidesTool,
  ReadPullRequestGuideTool,
);
