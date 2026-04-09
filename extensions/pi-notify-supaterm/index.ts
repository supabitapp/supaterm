import { spawn } from "node:child_process";
import { basename } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const supatermCLIPath = process.env.SUPATERM_CLI_PATH;
const supatermSurfaceID = process.env.SUPATERM_SURFACE_ID;
const supatermSessionID = supatermSurfaceID
  ? `pi-notify-supaterm-${supatermSurfaceID.toLowerCase()}`
  : undefined;
const supatermRunningHeartbeatMs = 5000;
const taskCompleteThresholdMs = 15000;
const defaultPermissionMode = "acceptEdits";
const titleFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type SupatermHookEventName =
  | "Notification"
  | "PreToolUse"
  | "SessionEnd"
  | "SessionStart"
  | "Stop";

type SupatermHookEvent = {
  hook_event_name: SupatermHookEventName;
  agent_type?: string;
  cwd: string;
  last_assistant_message?: string;
  message?: string;
  model?: string;
  notification_type?: string;
  permission_mode?: string;
  reason?: string;
  session_id?: string;
  source: string;
  title?: string;
};

type NotificationState = "Error" | "Task Complete" | "Truncated" | "Waiting";

type AssistantMessageLike = {
  role: "assistant";
  content?: Array<{ type?: string; text?: string }>;
  errorMessage?: string;
  stopReason?: string;
};

type ToolEventLike = {
  content?: Array<{ type?: string; text?: string }>;
  input: Record<string, unknown>;
  isError?: boolean;
  toolName: string;
};

type RunState = {
  bashCount: number;
  changedFiles: Set<string>;
  firstToolError?: string;
  readFiles: Set<string>;
  searchCount: number;
  startedAt: number;
  toolCalls: number;
};

type TitleContext = {
  hasUI?: boolean;
  ui?: {
    setTitle?: (title: string) => void;
  };
};

function isSupatermPane(): boolean {
  return Boolean(supatermCLIPath && supatermSessionID);
}

function createRunState(): RunState {
  return {
    bashCount: 0,
    changedFiles: new Set<string>(),
    readFiles: new Set<string>(),
    searchCount: 0,
    startedAt: Date.now(),
    toolCalls: 0,
  };
}

async function sendSupatermHook(event: SupatermHookEvent): Promise<void> {
  if (!supatermCLIPath || !supatermSessionID) {
    return;
  }

  await new Promise<void>((resolve) => {
    const child = spawn(supatermCLIPath, ["agent", "receive-agent-hook", "--agent", "pi"], {
      env: process.env,
      stdio: ["pipe", "ignore", "ignore"],
    });

    const finish = () => resolve();

    child.on("error", finish);
    child.on("close", finish);
    child.stdin?.on("error", finish);
    child.stdin?.end(
      JSON.stringify({
        ...event,
        session_id: supatermSessionID,
      })
    );
  });
}

function supatermHookEvent(
  hookEventName: SupatermHookEventName,
  extra: Omit<SupatermHookEvent, "cwd" | "hook_event_name" | "session_id" | "source"> = {}
): SupatermHookEvent {
  return {
    ...extra,
    cwd: process.cwd(),
    hook_event_name: hookEventName,
    session_id: supatermSessionID,
    source: "pi-notify-supaterm",
  };
}

function notify(title: string, body: string): void {
  const sTitle = normalizeText(title);
  const sBody = normalizeText(body);
  process.stdout.write(`\x1b]777;notify;${sTitle};${sBody}\x07`);
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (minutes < 60) {
    return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h${remainingMinutes > 0 ? `${remainingMinutes}m` : ""}`;
}

function cleanModelName(name: string): string {
  return name
    .replace(/\s*\(.*?\)/g, "")
    .replace(/High|Medium|Low/g, (m) => m[0])
    .trim();
}

function normalizeText(value: string): string {
  return value.replace(/;/g, ":").replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function getInputPath(event: ToolEventLike): string | undefined {
  const path = event.input.path;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

function getFirstText(event: ToolEventLike): string | undefined {
  if (!Array.isArray(event.content)) {
    return undefined;
  }

  const part = event.content.find(
    (item) => item.type === "text" && typeof item.text === "string"
  );
  if (!part || typeof part.text !== "string") {
    return undefined;
  }

  const text = normalizeText(part.text);
  return text.length > 0 ? text : undefined;
}

function summarizeToolError(event: ToolEventLike): string {
  const path = getInputPath(event);
  if (path) {
    return `${event.toolName} failed for ${basename(path)}`;
  }

  if (event.toolName === "bash") {
    const command = event.input.command;
    if (typeof command === "string" && command.trim().length > 0) {
      return truncate(
        `bash failed: ${normalizeText(command.split("\n")[0] ?? command)}`,
        120
      );
    }
  }

  const text = getFirstText(event);
  if (text) {
    return truncate(text, 120);
  }

  return `${event.toolName} failed`;
}

function isAssistantMessage(message: unknown): message is AssistantMessageLike {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { role?: string }).role === "assistant"
  );
}

function getLastAssistantMessage(messages: readonly unknown[]): AssistantMessageLike | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isAssistantMessage(message)) {
      return message;
    }
  }

  return undefined;
}

function summarizeAssistantText(message: AssistantMessageLike | undefined): string | undefined {
  if (!message || !Array.isArray(message.content)) {
    return undefined;
  }

  const text = normalizeText(
    message.content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join(" ")
  );

  return text.length > 0 ? truncate(text, 120) : undefined;
}

function summarizeRunError(
  message: AssistantMessageLike | undefined,
  fallbackError: string | undefined
): string | undefined {
  if (!message) {
    return fallbackError;
  }

  if (message.stopReason !== "error" && message.stopReason !== "aborted") {
    return undefined;
  }

  const summary = normalizeText(
    message.errorMessage ??
      summarizeAssistantText(message) ??
      fallbackError ??
      "Agent run failed"
  );
  return summary.length > 0 ? truncate(summary, 120) : undefined;
}

function summarizeSuccess(state: RunState, durationMs: number, includeDuration: boolean): string {
  const changedCount = state.changedFiles.size;
  if (changedCount === 1) {
    const [file] = [...state.changedFiles];
    const summary = `Updated ${basename(file)}`;
    return includeDuration ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }

  if (changedCount > 1) {
    const summary = `Updated ${changedCount} ${pluralize(changedCount, "file")}`;
    return includeDuration ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }

  const readCount = state.readFiles.size;
  if (readCount === 1) {
    const [file] = [...state.readFiles];
    const summary = `Reviewed ${basename(file)}`;
    return includeDuration ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }

  if (readCount > 1) {
    const summary = `Reviewed ${readCount} ${pluralize(readCount, "file")}`;
    return includeDuration ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }

  if (state.searchCount > 0 && state.bashCount > 0) {
    const summary = `Ran ${state.searchCount} ${pluralize(state.searchCount, "search")} and ${state.bashCount} ${pluralize(state.bashCount, "shell command")}`;
    return includeDuration ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }

  if (state.searchCount > 0) {
    const summary = state.searchCount === 1 ? "Searched the codebase" : `Ran ${state.searchCount} searches`;
    return includeDuration ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }

  if (state.bashCount > 0) {
    const summary = `Ran ${state.bashCount} ${pluralize(state.bashCount, "shell command")}`;
    return includeDuration ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }

  if (state.toolCalls > 0) {
    const summary = `Ran ${state.toolCalls} ${pluralize(state.toolCalls, "operation")}`;
    return includeDuration ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }

  if (includeDuration) {
    return `Finished in ${formatDuration(durationMs)}`;
  }

  return "Finished and waiting for input";
}

function buildBody(summary: string, projectName: string, sessionName: string | undefined): string {
  const context = sessionName ? `${projectName} · ${sessionName}` : undefined;
  return truncate([summary, context].filter(Boolean).join(" · "), 160);
}

function hasTitleUI(ctx: unknown): ctx is TitleContext {
  return (
    typeof ctx === "object" &&
    ctx !== null &&
    (ctx as TitleContext).hasUI === true &&
    typeof (ctx as TitleContext).ui?.setTitle === "function"
  );
}

export default function (pi: ExtensionAPI) {
  const projectName = basename(process.cwd());
  let runState = createRunState();
  let currentSessionName: string | undefined;
  let currentTool: string | undefined;
  let spinnerFrameIndex = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;
  let supatermHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let pendingSupatermHeartbeat = Promise.resolve();
  let titleContext: TitleContext | undefined;

  function setTitle(title: string): void {
    titleContext?.ui?.setTitle?.(title);
  }

  function buildTitle(...parts: Array<string | undefined>): string {
    return truncate(
      ["π", projectName, currentSessionName, ...parts]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(" · "),
      120
    );
  }

  function updateIdleTitle(state?: NotificationState): void {
    setTitle(buildTitle(state));
  }

  function updateWorkingTitle(): void {
    const frame = titleFrames[spinnerFrameIndex % titleFrames.length] ?? titleFrames[0] ?? ".";
    const activity = currentTool ? `Executing ${currentTool}` : "Thinking";
    setTitle(`${frame} ${buildTitle(activity)}`);
  }

  function stopSpinner(): void {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = undefined;
    }
  }

  function startSpinner(): void {
    stopSpinner();
    spinnerFrameIndex = 0;
    updateWorkingTitle();
    spinnerTimer = setInterval(() => {
      spinnerFrameIndex += 1;
      updateWorkingTitle();
    }, 250);
  }

  function queueSupatermRunningHeartbeat(): Promise<void> {
    if (!isSupatermPane()) {
      return Promise.resolve();
    }

    pendingSupatermHeartbeat = pendingSupatermHeartbeat.then(() =>
      sendSupatermHook(
        supatermHookEvent("PreToolUse", {
          permission_mode: defaultPermissionMode,
        })
      )
    );
    return pendingSupatermHeartbeat;
  }

  function startSupatermRunningHeartbeat(): void {
    stopSupatermRunningHeartbeat();
    void queueSupatermRunningHeartbeat();
    supatermHeartbeatTimer = setInterval(() => {
      void queueSupatermRunningHeartbeat();
    }, supatermRunningHeartbeatMs);
  }

  async function stopSupatermRunningHeartbeat(): Promise<void> {
    if (supatermHeartbeatTimer) {
      clearInterval(supatermHeartbeatTimer);
      supatermHeartbeatTimer = undefined;
    }
    await pendingSupatermHeartbeat;
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!hasTitleUI(ctx)) {
      return;
    }

    titleContext = ctx;
    currentSessionName = pi.getSessionName();
    updateIdleTitle();
  });

  pi.on("agent_start", async (_event, ctx) => {
    runState = createRunState();
    currentSessionName = pi.getSessionName();
    currentTool = undefined;

    if (hasTitleUI(ctx)) {
      titleContext = ctx;
      startSpinner();
    }

    if (isSupatermPane()) {
      await sendSupatermHook(
        supatermHookEvent("SessionStart", {
          agent_type: "assistant",
          model: cleanModelName(ctx.model?.name ?? "Pi"),
          title: "Pi",
        })
      );
      startSupatermRunningHeartbeat();
    }
  });

  pi.on("tool_call", async (event) => {
    runState.toolCalls += 1;
    currentTool = event.toolName;

    if (spinnerTimer) {
      updateWorkingTitle();
    }
  });

  pi.on("tool_result", async (event) => {
    if (event.isError && !runState.firstToolError) {
      runState.firstToolError = summarizeToolError(event);
    }

    const path = getInputPath(event);

    if (event.toolName === "read") {
      if (path && !event.isError) {
        runState.readFiles.add(path);
      }
      return;
    }

    if (event.toolName === "edit" || event.toolName === "write") {
      if (path && !event.isError) {
        runState.changedFiles.add(path);
      }
      return;
    }

    if (event.toolName === "grep" || event.toolName === "find") {
      if (!event.isError) {
        runState.searchCount += 1;
      }
      return;
    }

    if (event.toolName === "bash" && !event.isError) {
      runState.bashCount += 1;
    }

    if (currentTool === event.toolName) {
      currentTool = undefined;
    }

    if (spinnerTimer) {
      updateWorkingTitle();
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    const durationMs = Date.now() - runState.startedAt;
    const projectName = basename(process.cwd());
    const sessionName = pi.getSessionName();
    const assistantMessage = getLastAssistantMessage(event.messages);
    const runError = summarizeRunError(assistantMessage, runState.firstToolError);
    const isTruncated = assistantMessage?.stopReason === "length";
    const isTaskComplete = runState.changedFiles.size > 0 || durationMs >= taskCompleteThresholdMs;

    let state: NotificationState;
    let summary: string;

    if (runError) {
      state = "Error";
      summary = runError;
    } else if (isTruncated) {
      state = "Truncated";
      const successSummary = summarizeSuccess(runState, durationMs, isTaskComplete);
      summary = successSummary === "Finished and waiting for input"
        ? "Response truncated"
        : `${successSummary} · response truncated`;
    } else {
      state = isTaskComplete ? "Task Complete" : "Waiting";
      summary = summarizeSuccess(runState, durationMs, isTaskComplete);
    }

    const body = buildBody(summary, projectName, sessionName);
    currentTool = undefined;
    stopSpinner();
    updateIdleTitle(state);

    if (isSupatermPane()) {
      await stopSupatermRunningHeartbeat();
      await sendSupatermHook(
        supatermHookEvent("Notification", {
          message: body,
          notification_type: state === "Error" ? "error" : "request_input",
          title: body,
        })
      );
      await sendSupatermHook(
        supatermHookEvent("Stop", {
          permission_mode: defaultPermissionMode,
        })
      );
      return;
    }

    notify(body, body);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopSpinner();
    await stopSupatermRunningHeartbeat();

    if (hasTitleUI(ctx)) {
      titleContext = ctx;
      currentTool = undefined;
      updateIdleTitle();
    }

    if (isSupatermPane()) {
      await sendSupatermHook(
        supatermHookEvent("SessionEnd", {
          reason: "exit",
          title: "Pi",
        })
      );
    }
  });
}
