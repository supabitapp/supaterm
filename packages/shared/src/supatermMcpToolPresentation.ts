export type SupatermMcpToolLogo = "supaterm";

export interface SupatermMcpToolPresentation {
  readonly displayName: string;
  readonly logo: SupatermMcpToolLogo;
}

export type SupatermMcpToolSummaryAction =
  | "capabilities"
  | "delegate"
  | "task-status"
  | "task-cancel"
  | "schedule-run"
  | "schedule-create"
  | "schedule-list"
  | "schedule-update"
  | "schedule-delete"
  | "thread-create"
  | "thread-list"
  | "thread-read"
  | "thread-send"
  | "thread-wait"
  | "thread-interrupt"
  | "workflow-stop"
  | "thread-configuration"
  | "thread-configure"
  | "thread-fork"
  | "thread-merge"
  | "thread-search"
  | "thread-transfers"
  | "thread-organize"
  | "thread-update"
  | "queue-list"
  | "queue-read"
  | "queue-edit"
  | "queue-cancel"
  | "queue-reorder"
  | "queue-steer"
  | "question-list"
  | "question-read"
  | "question-respond"
  | "worktree-handoff"
  | "worktree-list"
  | "worktree-status"
  | "project-list"
  | "project-read"
  | "project-create"
  | "project-update"
  | "project-delete"
  | "project-clone"
  | "environment-read"
  | "environment-update"
  | "attachment-prepare"
  | "attachment-discard"
  | "attachment-send"
  | "link-pr"
  | "unlink-pr"
  | "list-prs"
  | "watch-pr"
  | "unwatch-pr"
  | "watch-run"
  | "unwatch-run"
  | "write-pr-guides"
  | "read-pr-guide"
  | "browser"
  | "device"
  | "html-preview"
  | "html-render";

export interface SupatermMcpToolDefinition {
  readonly displayName: string;
  readonly labels: readonly [action: string, running: string, completed: string, detail: string];
  readonly icon: "supaterm" | "browser" | "device" | "pull-request";
  readonly summaryAction: SupatermMcpToolSummaryAction;
}

function tool(
  labels: SupatermMcpToolDefinition["labels"],
  summaryAction: SupatermMcpToolSummaryAction,
  icon: SupatermMcpToolDefinition["icon"] = "supaterm",
  displayName = `${labels[0]} ${labels[3]}`,
): SupatermMcpToolDefinition {
  return { displayName, labels, icon, summaryAction };
}

const SUPATERM_MCP_SERVER_NAME = "supaterm";

const SUPATERM_MCP_TOOLS: Readonly<Record<string, SupatermMcpToolDefinition>> = {
  link_pull_request: tool(
    ["Link", "Linking", "Linked", "a pull request"],
    "link-pr",
    "pull-request",
  ),
  unlink_pull_request: tool(
    ["Unlink", "Unlinking", "Unlinked", "a pull request"],
    "unlink-pr",
    "pull-request",
  ),
  list_thread_pull_requests: tool(
    ["Check", "Checking", "Checked", "linked pull requests"],
    "list-prs",
    "pull-request",
  ),
  watch_pull_request: tool(
    ["Watch", "Watching", "Watching", "a pull request"],
    "watch-pr",
    "pull-request",
  ),
  unwatch_pull_request: tool(
    ["Stop watching", "Unwatching", "Stopped watching", "a pull request"],
    "unwatch-pr",
    "pull-request",
  ),
  watch_workflow_run: tool(
    ["Watch", "Watching", "Watching", "a workflow run"],
    "watch-run",
    "pull-request",
  ),
  unwatch_workflow_run: tool(
    ["Stop watching", "Stopping watching", "Stopped watching", "a workflow run"],
    "unwatch-run",
    "pull-request",
  ),
  write_pull_request_guides: tool(
    ["Write", "Writing", "Started writing", "review guides"],
    "write-pr-guides",
    "pull-request",
  ),
  read_pull_request_guide: tool(
    ["Read", "Reading", "Read", "a review guide"],
    "read-pr-guide",
    "pull-request",
  ),
  orchestrator_capabilities: tool(
    ["Get", "Getting", "Got", "orchestration capabilities"],
    "capabilities",
  ),
  delegate_task: tool(["Delegate", "Delegating", "Delegated", "a child task"], "delegate"),
  task_status: tool(["Get", "Getting", "Got", "delegated task status"], "task-status"),
  task_cancel: tool(
    ["Cancel", "Canceling", "Requested cancellation of", "a delegated task"],
    "task-cancel",
  ),
  schedule_task: tool(
    ["Schedule", "Scheduling", "Scheduled", "a recurring task"],
    "schedule-create",
  ),
  list_scheduled_tasks: tool(["List", "Listing", "Listed", "scheduled tasks"], "schedule-list"),
  update_scheduled_task: tool(
    ["Update", "Updating", "Updated", "a scheduled task"],
    "schedule-update",
  ),
  delete_scheduled_task: tool(
    ["Delete", "Deleting", "Requested deletion of", "a scheduled task"],
    "schedule-delete",
  ),
  create_threads: tool(["Create", "Creating", "Created", "Supaterm threads"], "thread-create"),
  supaterm_thread_start: tool(
    ["Start", "Starting", "Started", "a Supaterm thread"],
    "thread-create",
  ),
  supaterm_thread_list: tool(["List", "Listing", "Listed", "Supaterm threads"], "thread-list"),
  supaterm_thread_read: tool(["Read", "Reading", "Read", "a Supaterm thread"], "thread-read"),
  supaterm_thread_send: tool(["Send", "Sending", "Sent", "to a Supaterm thread"], "thread-send"),
  supaterm_thread_wait: tool(["Wait", "Waiting", "Waited", "for a Supaterm thread"], "thread-wait"),
  supaterm_workflow_stop: tool(
    ["Stop", "Stopping", "Requested a stop for", "a workflow"],
    "workflow-stop",
  ),
  supaterm_thread_interrupt: tool(
    ["Interrupt", "Interrupting", "Requested an interrupt of", "a Supaterm thread"],
    "thread-interrupt",
  ),
  supaterm_worktree_handoff: tool(
    ["Hand off", "Handing off", "Handed off", "thread to a git worktree"],
    "worktree-handoff",
  ),
  supaterm_worktree_status: tool(
    ["Get", "Getting", "Got", "thread worktree status"],
    "worktree-status",
  ),
  preview_status: tool(["Get", "Getting", "Got", "preview browser status"], "browser", "browser"),
  preview_open: tool(
    ["Open", "Opening", "Opened", "a page in the preview browser"],
    "browser",
    "browser",
  ),
  preview_navigate: tool(
    ["Navigate", "Navigating", "Navigated", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_dialog: tool(
    ["Respond", "Responding", "Responded", "to a preview browser dialog"],
    "browser",
    "browser",
  ),
  preview_snapshot: tool(
    ["Take a snapshot of", "Taking a snapshot of", "Took a snapshot of", "the preview page"],
    "browser",
    "browser",
    "Snapshot the preview page",
  ),
  preview_click: tool(
    ["Click", "Clicking", "Clicked", "in the preview browser"],
    "browser",
    "browser",
  ),
  preview_press: tool(
    ["Press", "Pressing", "Pressed", "a key in the preview browser"],
    "browser",
    "browser",
  ),
  preview_type: tool(["Type", "Typing", "Typed", "in the preview browser"], "browser", "browser"),
  preview_hover: tool(
    ["Hover", "Hovering", "Hovered", "in the preview browser"],
    "browser",
    "browser",
  ),
  preview_select: tool(
    ["Choose", "Choosing", "Chose", "an option in the preview browser"],
    "browser",
    "browser",
  ),
  preview_drag: tool(
    ["Drag", "Dragging", "Dragged", "in the preview browser"],
    "browser",
    "browser",
  ),
  preview_upload: tool(
    ["Upload", "Uploading", "Uploaded", "files to the preview browser"],
    "browser",
    "browser",
  ),
  preview_scroll: tool(
    ["Scroll", "Scrolling", "Scrolled", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_resize: tool(
    ["Resize", "Resizing", "Resized", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_evaluate: tool(
    ["Evaluate", "Evaluating", "Evaluated", "script in the preview browser"],
    "browser",
    "browser",
  ),
  preview_wait_for: tool(
    ["Wait", "Waiting", "Waited", "for the preview page"],
    "browser",
    "browser",
  ),
  preview_set_appearance: tool(
    ["Set", "Setting", "Set", "preview browser appearance"],
    "browser",
    "browser",
  ),
  preview_recording_start: tool(
    ["Start", "Starting", "Started", "recording the preview browser"],
    "browser",
    "browser",
  ),
  preview_recording_stop: tool(
    ["Stop", "Stopping", "Stopped", "recording the preview browser"],
    "browser",
    "browser",
  ),
  device_list: tool(["List", "Listing", "Listed", "simulators and emulators"], "device", "device"),
  device_open: tool(
    ["Open", "Opening", "Opened", "a device in the Device panel"],
    "device",
    "device",
  ),
  device_screenshot: tool(
    ["Take a screenshot of", "Taking a screenshot of", "Took a screenshot of", "the device"],
    "device",
    "device",
  ),
  device_close: tool(["Close", "Closing", "Closed", "a device"], "device", "device"),
  run_scheduled_task_now: tool(
    ["Run", "Running", "Requested a run of", "a scheduled task"],
    "schedule-run",
  ),
  supaterm_queue_list: tool(["List", "Listing", "Listed", "queued messages"], "queue-list"),
  supaterm_queue_read: tool(["Read", "Reading", "Read", "a queued message"], "queue-read"),
  supaterm_queue_edit: tool(["Edit", "Editing", "Edited", "a queued message"], "queue-edit"),
  supaterm_queue_cancel: tool(
    ["Cancel", "Canceling", "Requested cancellation of", "a queued run"],
    "queue-cancel",
  ),
  supaterm_queue_reorder: tool(
    ["Reorder", "Reordering", "Reordered", "a queued run"],
    "queue-reorder",
  ),
  supaterm_queue_promote_to_steer: tool(
    ["Steer with", "Steering with", "Requested steering with", "a queued message"],
    "queue-steer",
  ),
  supaterm_pending_request_list: tool(
    ["List", "Listing", "Listed", "pending questions"],
    "question-list",
  ),
  supaterm_pending_request_read: tool(
    ["Read", "Reading", "Read", "pending questions"],
    "question-read",
  ),
  supaterm_pending_request_respond: tool(
    ["Answer", "Answering", "Answered", "pending questions"],
    "question-respond",
  ),
  supaterm_thread_configuration: tool(
    ["Read", "Reading", "Read", "thread configuration"],
    "thread-configuration",
  ),
  supaterm_thread_configure: tool(["Set", "Setting", "Set", "thread model"], "thread-configure"),
  supaterm_thread_fork: tool(
    ["Fork", "Forking", "Requested a fork of", "this thread"],
    "thread-fork",
  ),
  supaterm_thread_merge_back: tool(
    ["Merge", "Merging", "Requested a merge of", "thread context"],
    "thread-merge",
  ),
  supaterm_thread_search: tool(
    ["Search", "Searching", "Searched", "thread content"],
    "thread-search",
  ),
  supaterm_thread_transfers: tool(
    ["Read", "Reading", "Read", "thread transfers"],
    "thread-transfers",
  ),
  supaterm_thread_organize: tool(
    ["Organize", "Organizing", "Organized", "a thread"],
    "thread-organize",
  ),
  supaterm_thread_update: tool(
    ["Update", "Updating", "Updated", "Supaterm thread metadata"],
    "thread-update",
  ),
  supaterm_worktree_list: tool(
    ["List", "Listing", "Listed", "workspace branches"],
    "worktree-list",
  ),
  supaterm_preview_list: tool(["List", "Listing", "Listed", "preview tabs"], "browser", "browser"),
  supaterm_preview_close: tool(
    ["Close", "Closing", "Closed", "a preview tab"],
    "browser",
    "browser",
  ),
  supaterm_environment_read: tool(
    ["Read", "Reading", "Read", "environment preferences"],
    "environment-read",
  ),
  supaterm_environment_preferences_update: tool(
    ["Update", "Updating", "Updated", "environment preferences"],
    "environment-update",
  ),
  supaterm_thread_launch: tool(
    ["Launch", "Launching", "Launched", "a project thread"],
    "thread-create",
  ),
  supaterm_project_list: tool(["List", "Listing", "Listed", "projects"], "project-list"),
  supaterm_project_read: tool(["Read", "Reading", "Read", "a project"], "project-read"),
  supaterm_project_create: tool(
    ["Register", "Registering", "Registered", "a project"],
    "project-create",
  ),
  supaterm_project_update: tool(["Update", "Updating", "Updated", "a project"], "project-update"),
  supaterm_project_delete: tool(["Delete", "Deleting", "Deleted", "a project"], "project-delete"),
  supaterm_project_clone: tool(["Clone", "Cloning", "Cloned", "a repository"], "project-clone"),
  supaterm_attachment_prepare_upload: tool(
    ["Prepare", "Preparing", "Prepared", "an attachment upload"],
    "attachment-prepare",
  ),
  supaterm_attachment_discard: tool(
    ["Discard", "Discarding", "Discarded", "a pending attachment"],
    "attachment-discard",
  ),
  supaterm_thread_send_attachments: tool(
    ["Send", "Sending", "Sent", "attachments"],
    "attachment-send",
  ),
  html_preview: tool(["Preview", "Previewing", "Previewed", "an HTML page"], "html-preview"),
  html_render: tool(["Render", "Rendering", "Rendered", "an HTML page"], "html-render"),
};

export const SUPATERM_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.keys(SUPATERM_MCP_TOOLS),
);

function normalizeSupatermMcpToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

/**
 * ACP agents disagree on how the injected Supaterm server prefixes its tools:
 * `mcp__supaterm__x` (Claude/Cursor), `supaterm.x` (Codex), plus single
 * underscore, colon, slash, dash, and space separators seen from registry
 * agents. The prefix match is deliberately loose because the display-name
 * inventory is the real gate; unknown tools stay on the generic renderer.
 */
function resolveSupatermMcpToolName(value: string): string | null {
  const label = normalizeSupatermMcpToolLabel(value);
  const mcpMatch = /^mcp__(?<server>.+?)__(?<tool>.+)$/i.exec(label);
  if (mcpMatch?.groups) {
    const { server, tool } = mcpMatch.groups;
    return tool !== undefined && server?.toLowerCase() === SUPATERM_MCP_SERVER_NAME ? tool : null;
  }

  const namespaceMatch = /^supaterm(?:[.:/]|\s*·\s*)(?<tool>.+)$/i.exec(label);
  if (namespaceMatch?.groups) {
    return namespaceMatch.groups.tool ?? null;
  }

  if (Object.hasOwn(SUPATERM_MCP_TOOLS, label)) {
    return label;
  }

  const candidate = /^(?:mcp[-_]{1,2})?supaterm(?:__|[-_.:/ ])(?<tool>.+)$/i.exec(label)?.groups
    ?.tool;
  if (candidate !== undefined && Object.hasOwn(SUPATERM_MCP_TOOLS, candidate)) return candidate;
  // OpenCode 2 registers one server per thread, `supaterm-<thread>`, and joins
  // it to the tool with `_`. Thread ids can hold `_` too, so take the longest
  // known tool name that ends the label.
  if (!/^supaterm-/i.test(label)) return null;
  let longest: string | null = null;
  for (const tool of Object.keys(SUPATERM_MCP_TOOLS)) {
    if (label.endsWith(`_${tool}`) && tool.length > (longest?.length ?? 0)) longest = tool;
  }
  return longest;
}

export function resolveSupatermMcpToolId(toolName: string | null | undefined): string | null {
  const name = toolName == null ? null : resolveSupatermMcpToolName(toolName);
  return name !== null && Object.hasOwn(SUPATERM_MCP_TOOLS, name) ? name : null;
}

export function resolveSupatermMcpToolDefinition(
  toolName: string | null | undefined,
): SupatermMcpToolDefinition | null {
  const name = toolName == null ? null : resolveSupatermMcpToolName(toolName);
  return name !== null && Object.hasOwn(SUPATERM_MCP_TOOLS, name)
    ? SUPATERM_MCP_TOOLS[name]!
    : null;
}

export function resolveSupatermMcpToolPresentation(
  toolName: string | null | undefined,
): SupatermMcpToolPresentation | null {
  const definition = resolveSupatermMcpToolDefinition(toolName);
  return definition === null ? null : { displayName: definition.displayName, logo: "supaterm" };
}

export function resolveSupatermMcpToolSummaryAction(
  toolName: string | null | undefined,
): SupatermMcpToolSummaryAction | null {
  return resolveSupatermMcpToolDefinition(toolName)?.summaryAction ?? null;
}
