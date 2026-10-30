import { ProviderInstanceId } from "@supaterm/contracts";
import * as Context from "effect/Context";
import { Tool } from "effect/ai";
import * as McpSchema from "effect/ai/McpSchema";
import * as McpInvocationContext from "../../apps/server/src/mcp/McpInvocationContext.ts";
import { advertisedJsonSchema } from "../../apps/server/src/mcp/advertisedJsonSchema.ts";
import { buildCodexAdditionalContext } from "../../apps/server/src/provider/CodexDeveloperInstructions.ts";
import { AttachmentToolkit } from "../../apps/server/src/mcp/toolkits/attachment/tools.ts";
import { DeviceToolkit } from "../../apps/server/src/mcp/toolkits/device/tools.ts";
import { EnvironmentToolkit } from "../../apps/server/src/mcp/toolkits/environment/tools.ts";
import { HtmlToolkit } from "../../apps/server/src/mcp/toolkits/html/tools.ts";
import { OrchestratorToolkit } from "../../apps/server/src/mcp/toolkits/orchestrator/tools.ts";
import { PreviewToolkit } from "../../apps/server/src/mcp/toolkits/preview/tools.ts";
import { PreviewControlsToolkit } from "../../apps/server/src/mcp/toolkits/previewControls/tools.ts";
import { ProjectToolkit } from "../../apps/server/src/mcp/toolkits/project/tools.ts";
import { PullRequestsToolkit } from "../../apps/server/src/mcp/toolkits/pullRequests/tools.ts";
import { ThreadToolkit } from "../../apps/server/src/mcp/toolkits/thread/tools.ts";
import { WorktreeToolkit } from "../../apps/server/src/mcp/toolkits/worktree/tools.ts";
import {
  CLAUDE_PROVIDER,
  makeClaudeQueryOptions,
} from "../../apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { type ApiTool } from "./types.ts";
import { Supaterm_PREFIX, isRecord, valueText } from "./protocol.ts";
import { type Model, isCodex } from "./models.ts";

const supatermSourceTools: ReadonlyArray<Tool.Any> = [
  OrchestratorToolkit,
  ThreadToolkit,
  AttachmentToolkit,
  ProjectToolkit,
  EnvironmentToolkit,
  PreviewControlsToolkit,
  WorktreeToolkit,
  PullRequestsToolkit,
  PreviewToolkit,
  DeviceToolkit,
  HtmlToolkit,
].flatMap((toolkit): ReadonlyArray<Tool.Any> => Object.values(toolkit.tools));

const supatermTools: ReadonlyArray<ApiTool> = supatermSourceTools.map((tool) => ({
  name: `${Supaterm_PREFIX}${tool.name}`,
  description: Tool.getDescription(tool) ?? "",
  input_schema: advertisedJsonSchema(tool),
}));

const enabledWhen = (predicate: () => boolean) =>
  new Set(
    supatermSourceTools
      .values()
      .filter(
        (tool) => Context.getOrUndefined(tool.annotations, McpSchema.EnabledWhen) === predicate,
      )
      .map((tool) => `${Supaterm_PREFIX}${tool.name}`),
  );

const hiddenFromSubagents = enabledWhen(McpInvocationContext.hiddenFromSubagents);

const hiddenWhileLinksOff = enabledWhen(McpInvocationContext.hiddenWhileLinksOff);

export const visibleSupatermTools = (options: {
  readonly subagent?: boolean;
  readonly links?: boolean;
}) =>
  supatermTools.filter(
    (tool) =>
      (options.links === true || !hiddenWhileLinksOff.has(tool.name)) &&
      !(options.subagent === true && hiddenFromSubagents.has(tool.name)),
  );

const claudeQueryOptions = (model: Model, device = true) => {
  const input: Parameters<typeof makeClaudeQueryOptions>[0] & {
    readonly deviceToolsAvailable?: boolean;
  } = {
    modelSelection: { instanceId: ProviderInstanceId.make(CLAUDE_PROVIDER), model },
    nativeThreadId: "mcp-tool-use-eval",
    resume: false,
    cwd: null,
    mcpServers: { supaterm: { type: "http", url: "http://127.0.0.1/mcp" } },
    deviceToolsAvailable: device,
  };
  return makeClaudeQueryOptions(input);
};

export const supatermSystemAppend = (model: Model, device = true) => {
  const { systemPrompt } = claudeQueryOptions(model, device);
  if (isRecord(systemPrompt) && systemPrompt.type === "preset" && systemPrompt.append) {
    return systemPrompt.append;
  }
  throw new Error("makeClaudeQueryOptions no longer appends Supaterm text to a preset prompt.");
};

export const supatermSubagentContext = async (model: Model, device = true) => {
  const hooks = (claudeQueryOptions(model, device).hooks?.SubagentStart ?? []).flatMap(
    (m) => m.hooks,
  );
  const input = {
    hook_event_name: "SubagentStart" as const,
    session_id: "mcp-tool-use-eval",
    transcript_path: "",
    cwd: "",
    agent_id: "mcp-tool-use-eval",
    agent_type: "general-purpose",
  };
  const outputs = await Promise.all(
    hooks.map((hook) => hook(input, undefined, { signal: AbortSignal.timeout(10_000) })),
  );
  return outputs
    .flatMap((output) =>
      "hookSpecificOutput" in output && output.hookSpecificOutput?.hookEventName === "SubagentStart"
        ? [output.hookSpecificOutput.additionalContext ?? ""]
        : [],
    )
    .filter(Boolean)
    .join("\n\n");
};

export const supatermContextReport = (model: Model) => {
  const size = (chars: number) => `${chars} chars (~${Math.round(chars / 4)} tokens)`;
  const descriptions = supatermTools.reduce(
    (sum, tool) => sum + valueText(tool.description).length,
    0,
  );
  const schemas = JSON.stringify(supatermTools).length;
  return [
    `- Supaterm context: system text ${size((isCodex(model) ? JSON.stringify(buildCodexAdditionalContext({ model }, { browser: true, device: true })) : supatermSystemAppend(model)).length)}`,
    `tool descriptions ${size(descriptions)}`,
    `full tool schemas ${size(schemas)} across ${supatermTools.length} tools.`,
  ].join(", ");
};
