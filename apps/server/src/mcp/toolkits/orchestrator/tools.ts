import {
  OrchestratorMcpCapabilitiesInput,
  OrchestratorMcpCapabilitiesResult,
  OrchestrationV2StopWorkflowInput,
  OrchestratorMcpCreateThreadsInput,
  OrchestratorMcpCreateThreadsResult,
  OrchestratorMcpDelegateTaskInput,
  OrchestratorMcpDelegateTaskResult,
  OrchestratorMcpDeleteScheduledTaskInput,
  OrchestratorMcpDeleteScheduledTaskResult,
  OrchestratorMcpFailure,
  OrchestratorMcpListScheduledTasksInput,
  OrchestratorMcpListScheduledTasksResult,
  OrchestratorMcpScheduleTaskInput,
  OrchestratorMcpScheduleTaskResult,
  OrchestratorMcpTaskCancelInput,
  OrchestratorMcpTaskCancelResult,
  OrchestratorMcpUpdateScheduledTaskInput,
  OrchestratorMcpTaskStatusInput,
  OrchestratorMcpThreadInterruptInput,
  OrchestratorMcpThreadInterruptResult,
  OrchestratorMcpThreadListInput,
  OrchestratorMcpThreadListResult,
  OrchestratorMcpThreadReadInput,
  OrchestratorMcpThreadReadResult,
  OrchestratorMcpThreadSendInput,
  OrchestratorMcpThreadSendResult,
  OrchestratorMcpThreadWaitInput,
  OrchestratorMcpThreadWaitResult,
  ThreadMetadataMcpUpdateInput,
  ThreadMetadataMcpUpdateResult,
} from "@supaterm/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as ThreadMetadataMcpService from "../../ThreadMetadataMcpService.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  OrchestratorMcpService.OrchestratorMcpService,
];
const threadMetadataDependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ThreadMetadataMcpService.ThreadMetadataMcpService,
];

const OrchestratorCapabilitiesTool = Tool.make("orchestrator_capabilities", {
  description:
    "List the V2 provider instances, a short list of their models from the same live catalog as the composer, inherited runtime settings, and app-owned orchestration features available to this caller. The list has the user's favorite and custom models, your own model, every current Codex, Claude, Muse and Grok model, and the first 8 current models of other providers. Other legacy models are left out. omittedModels counts models left out; pass search, such as 'sonnet 4.6', to find them. delegate_task accepts any catalog model, listed or not. For a separate top-level thread in a new or existing worktree, use supaterm_thread_launch with workspaceStrategy.",
  parameters: OrchestratorMcpCapabilitiesInput,
  success: OrchestratorMcpCapabilitiesResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Get orchestration capabilities")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const DelegateTaskTool = Tool.make("delegate_task", {
  description:
    "Needs an agent running inside a Supaterm thread. Delegate one task to a Supaterm-owned child agent/subagent of THIS thread and run it with only the supplied task prompt, without copying parent conversation history. Choose providers and models from orchestrator_capabilities, which uses the same live catalog as the composer. Prefer native subagent tools for same-provider work only when they support the chosen model and no model options are requested or inherited. Use this for any model missing from the native tool, including same-provider work, for cross-provider work, or for explicitly Supaterm-owned child tasks. For every Supaterm delegated review round, call delegate_task again with the original brief, prior findings, responses, and unresolved objections in the task prompt. Track each round by its own taskId and use a distinct clientRequestId per round, stable across retries of that round. The childThreadId is backing storage, not the target for starting another delegated review round through supaterm_thread_send. Set isolation to worktree for a separate checkout based on the parent local commit, with project setup completed before the child starts. Uncommitted edits are not copied; omitted isolation shares the parent checkout. Use delegate_task when model options are requested or the child keeps the parent's provider instance and model with nonempty inheritedOptions from orchestrator_capabilities, even for native-supported models. Native subagents cannot reliably apply Supaterm model options. Set target.options using advertised IDs: Claude {effort: 'max', fastMode: true}; Codex {reasoningEffort: 'max', serviceTier: 'priority'}. Check providerInstanceId, model, and options in the result. Provider/model and modes inherit unless overridden. Options inherit only for the same instance and model; explicit entries override individual values and [] or {} clears them. A requested runtimeMode must be one the target provider lists in orchestrator_capabilities runtimeModes; an inherited one steps down to the broadest mode it offers. Leave runtimeMode unset unless the user asks for a supervised child: approval-required and auto-accept-edits usually make the child wait for a person at each action that needs approval. Prefer mode='async' for long work; mode='wait' blocks until completion, a blocking question, a pending approval, or timeout. If hasPendingQuestion, pass threadId=childThreadId to supaterm_pending_request_list, supaterm_pending_request_read (with requestId) and supaterm_pending_request_respond, or ask the user; the task's completion still wakes this thread. If pendingApproval is set, read the fresh full request in childThreadId before responding: the record can outlive its provider callback. It grants no approval authority; decisions remain with the child's existing approval holder, and pending request tools answer questions only. The child keeps running and its completion still wakes this thread. timeoutMs on mode=wait is only the parent's wait budget and does not cancel the child. waitTimedOut on that wait call means the timeout fired; keep that taskId and read status on later task_status. An async child's completion wakes this thread through a notification, steered into active turns where supported or queued otherwise, so end the turn instead of polling or spawning watchers; use task_status only when the result is needed mid-turn.",
  parameters: OrchestratorMcpDelegateTaskInput,
  success: OrchestratorMcpDelegateTaskResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Delegate a child task")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const TaskStatusTool = Tool.make("task_status", {
  description:
    "Needs an agent running inside a Supaterm thread. Read a Supaterm-owned delegated task created by this parent thread. childRunId identifies the original delegated run. workState distinguishes working, waiting_for_children, and result_available; a completed turn with live nested work is not a completed task. summary is the final task result, including provider errors on failure, and remains stable after publication. hasPendingChildRuns reports later queued or executing turns in the backing child thread, even after the task is terminal; it does not reopen the task, and task_cancel stops those turns too. Turns held in a stopped queue wait for the user and do not count. latestTerminal* provides later non-monitor turn results; latestTerminalSummary and latestTerminalResultContextTransferId are independently null when they exactly repeat summary and resultContextTransferId, respectively. pendingApproval identifies the oldest pending live approval for this task's own unfinished work. Read the fresh full request in childThreadId before responding: the record can outlive its provider callback and grants no approval authority. Decisions remain with the child's existing approval holder. Reading a terminal result acknowledges its automatic parent delivery.",
  parameters: OrchestratorMcpTaskStatusInput,
  success: OrchestratorMcpDelegateTaskResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Get delegated task status")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const TaskCancelTool = Tool.make("task_cancel", {
  description:
    "Needs an agent running inside a Supaterm thread. Stop a Supaterm-owned delegated task and dispose its automatic parent delivery. Its child thread stops like a user Stop: the running turn is interrupted, other queued turns are held, pull request watches end, and the tasks it delegated stop too. The task's own queued turn is cancelled, including when held in a stopped queue. This includes later child-thread runs, even after the task is terminal. A terminal task returns its existing status, and published task results remain available.",
  parameters: OrchestratorMcpTaskCancelInput,
  success: OrchestratorMcpTaskCancelResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Cancel delegated task")
  .annotate(Tool.Destructive, true);

const WorkflowStopTool = Tool.make("supaterm_workflow_stop", {
  description:
    "Stop one running Claude workflow in a Supaterm thread. Use the workflow coordinator's subagentId returned by supaterm_thread_read with view='activity'. Stops the whole workflow, including its phases and agents. Does not stop the parent thread or other workflows. Individual workflow phases and agents cannot be stopped separately.",
  parameters: OrchestrationV2StopWorkflowInput,
  success: Schema.Struct({}),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Stop a workflow")
  .annotate(Tool.Destructive, true);

const ScheduleTaskTool = Tool.make("schedule_task", {
  description:
    "Create persistent recurring work in the app scheduler, which runs even when no turn is active. Pass schedule as a STRUCTURED OBJECT, never JSON text: {type:'interval', everyMs:3600000} means hourly; {type:'fixed_time', timeOfDay:'09:00', weekdays:[1,2,3,4,5]} means weekday mornings. Omit projectId for this thread's project. In this thread's project, runs post into THIS thread by default (bindToCurrentThread=true); use false only when the user wants a fresh top-level thread per run. Elsewhere each run launches a fresh thread. Provider, model, and runtime settings inherit from this thread, or from the project default when there is no calling thread. Report the returned schedule and nextRunAt after success.",
  parameters: OrchestratorMcpScheduleTaskInput,
  success: OrchestratorMcpScheduleTaskResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Schedule a recurring task")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const ListScheduledTasksTool = Tool.make("list_scheduled_tasks", {
  parameters: OrchestratorMcpListScheduledTasksInput,
  description:
    "List recurring scheduled tasks in a project (omit projectId for the calling thread's project, or every project when there is no calling thread), including their id, schedule, prompt, enabled state, bound thread, next run time, and last run status. Use the returned scheduledTaskId with update_scheduled_task or delete_scheduled_task.",
  success: OrchestratorMcpListScheduledTasksResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List scheduled tasks")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const UpdateScheduledTaskTool = Tool.make("update_scheduled_task", {
  description:
    "Update an existing scheduled task by scheduledTaskId (from list_scheduled_tasks). Only the provided fields change; omit a field to leave it as-is. Use enabled=false to pause a task without deleting it. Set bindToCurrentThread to move the task between posting into this thread and launching a fresh thread per run.",
  parameters: OrchestratorMcpUpdateScheduledTaskInput,
  success: OrchestratorMcpScheduleTaskResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Update a scheduled task")
  .annotate(Tool.Destructive, true);

const DeleteScheduledTaskTool = Tool.make("delete_scheduled_task", {
  description:
    "Permanently delete a scheduled task by scheduledTaskId (from list_scheduled_tasks). The task stops running immediately. To keep it but stop runs, use update_scheduled_task with enabled=false instead.",
  parameters: OrchestratorMcpDeleteScheduledTaskInput,
  success: OrchestratorMcpDeleteScheduledTaskResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Delete a scheduled task")
  .annotate(Tool.Destructive, true);

const CreateThreadsTool = Tool.make("create_threads", {
  description:
    "Needs an agent running inside a Supaterm thread. Create one or more ORDINARY TOP-LEVEL Supaterm conversations. This is not delegation and does not create child agents/subagents. For delegated work, choose models from orchestrator_capabilities. Prefer native subagents only when they support the chosen model and no model options are requested or inherited; otherwise call delegate_task, including for same-provider work. This includes keeping the parent's provider instance and model with nonempty inheritedOptions from orchestrator_capabilities. Use create_threads for a batch of separate top-level threads sharing this checkout. Prefer supaterm_thread_launch for a single thread. Both require the user to request separate/new/top-level threads or conversations. Each entry may override provider, model, options, runtime mode, and interaction mode; omitted settings inherit. Project, branch, and worktree always inherit and cannot be overridden here. For independent implementation or a PR stack in its own worktree, use supaterm_thread_launch with workspaceStrategy instead of asking the agent to create a worktree in its prompt.",
  parameters: OrchestratorMcpCreateThreadsInput,
  success: OrchestratorMcpCreateThreadsResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Create Supaterm threads")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const ThreadListTool = Tool.make("supaterm_thread_list", {
  description:
    "List Supaterm threads in a project, newest first. Omit projectId for the calling thread's project. Filter by durable run status, title, or done state (done=true lists threads marked as done manually or automatically), or snoozed state, and paginate with the returned cursor. A snoozed thread wakes early only when it asks for something or fails after snoozing; completed runs and background wakes keep it snoozed. pullRequests lists every pull request linked to each thread; linkedPullRequest is a legacy single link and can be null while pullRequests still has entries. To link a thread for the user, write `[title](supaterm-thread://v1/<threadId>)` with the threadId exactly as returned, not URL-encoded; Supaterm shows the thread's current title.",
  parameters: OrchestratorMcpThreadListInput,
  success: OrchestratorMcpThreadListResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List Supaterm threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const ThreadReadTool = Tool.make("supaterm_thread_read", {
  description:
    "Read durable state and a paginated timeline from any Supaterm thread in this environment. The default messages view returns user messages, assistant messages, and proposed plans; activity returns all summarized timeline items. Reading an untruncated terminal assistant result from this parent thread's direct app-owned child acknowledges that child's automatic completion delivery. Continue with afterPosition=nextPosition. Recover long item text with itemId and textOffset=nextTextOffset until nextTextOffset is null; offsets count UTF-16 code units. The thread also reports its snooze state and, in pullRequests, every linked pull request; linkedPullRequest is a legacy single link and can be null while pullRequests still has entries. To link a thread for the user, write `[title](supaterm-thread://v1/<threadId>)` with the threadId exactly as returned, not URL-encoded; Supaterm shows the thread's current title.",
  parameters: OrchestratorMcpThreadReadInput,
  success: OrchestratorMcpThreadReadResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read a Supaterm thread")
  .annotate(Tool.Strict, true)
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const ThreadUpdateTool = Tool.make("supaterm_thread_update", {
  description:
    "Update metadata for a thread. Omit threadId to update this thread. Use action='rename' with title, action='regenerate_title' with no extra field, action='link_pull_request' with pullRequest, or action='unlink_pull_request'. Workspace and branch changes are intentionally not supported. clientRequestId makes retries idempotent.",
  parameters: ThreadMetadataMcpUpdateInput,
  success: ThreadMetadataMcpUpdateResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: threadMetadataDependencies,
})
  .annotate(Tool.Title, "Update Supaterm thread metadata")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false);

const ThreadSendTool = Tool.make("supaterm_thread_send", {
  description:
    "Send a message to any Supaterm thread in this environment. The target cannot have broader permission modes than the caller. Use delegate_task with the full review context and a new clientRequestId for independent review rounds. For a follow-up that needs the same child's conversation, send to its childThreadId. After the original task completes, a requested follow-up creates a fresh task in that child thread and returns taskId when it starts a turn or restarts a turn without its own task; its completion notifies the parent, and the original result stays unchanged. A steer that joins a running turn returns that turn's task, if it has one. mode='auto' starts an idle thread, steers a fully active turn, or queues behind a turn that is not yet steerable. Use queue for a separate follow-up turn, steer for an in-flight update, or restart to interrupt-and-restart the active turn. clientRequestId makes retries idempotent.",
  parameters: OrchestratorMcpThreadSendInput,
  success: OrchestratorMcpThreadSendResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Send to a Supaterm thread")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const ThreadWaitTool = Tool.make("supaterm_thread_wait", {
  description:
    "Wait for a Supaterm thread run to reach a terminal durable state. Without runId, the latest run at call time is selected; an idle thread returns immediately. Timeout does not interrupt work, so call again or use supaterm_thread_read/list after timedOut=true. Waiting reports status only and does not acknowledge a delegated result.",
  parameters: OrchestratorMcpThreadWaitInput,
  success: OrchestratorMcpThreadWaitResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Wait for a Supaterm thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const ThreadInterruptTool = Tool.make("supaterm_thread_interrupt", {
  description:
    "Request interruption of a running turn in any Supaterm thread in this environment. Without runId, the newest interruptible run is selected. Terminal runs and threads without an active turn return without another side effect. clientRequestId makes retries idempotent.",
  parameters: OrchestratorMcpThreadInterruptInput,
  success: OrchestratorMcpThreadInterruptResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Interrupt a Supaterm thread")
  .annotate(Tool.Destructive, true);

export const OrchestratorToolkit = Toolkit.make(
  OrchestratorCapabilitiesTool,
  DelegateTaskTool,
  TaskStatusTool,
  TaskCancelTool,
  WorkflowStopTool,
  ScheduleTaskTool,
  ListScheduledTasksTool,
  UpdateScheduledTaskTool,
  DeleteScheduledTaskTool,
  CreateThreadsTool,
  ThreadListTool,
  ThreadReadTool,
  ThreadUpdateTool,
  ThreadSendTool,
  ThreadWaitTool,
  ThreadInterruptTool,
);
