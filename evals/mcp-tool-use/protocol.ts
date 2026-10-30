import {
  type Base,
  type Usage,
  type ApiResponse,
  type Block,
  type Content,
  type ApiTool,
  type ToolUse,
  type Call,
} from "./types.ts";

export const Supaterm_PREFIX = "mcp__supaterm__";

export const TOOL_LOADED = "Tool loaded.";

export const NEUTRAL_IDENTITY = "You are an AI coding agent running in the user's terminal.";

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

export const addUsage = (total: Usage, usage: typeof ApiResponse.Type.usage) => {
  total.input += usage.input_tokens;
  total.output += usage.output_tokens;
  total.cacheWrite += usage.cache_creation_input_tokens ?? 0;
  total.cacheRead += usage.cache_read_input_tokens ?? 0;
};

export const text = (value: string): Block => ({ type: "text", text: value });

export const reminder = (value: string) => text(`<system-reminder>\n${value}\n</system-reminder>`);

export const valueText = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");

export const toolResult = (id: string, content: unknown): Block => ({
  type: "tool_result",
  tool_use_id: id,
  content: valueText(content),
});

export const texts = (content: typeof Content.Type) =>
  typeof content === "string" ? [content] : content.flatMap((block) => block.text ?? []);

export const isSupatermName = (name: string) =>
  name.startsWith(Supaterm_PREFIX) || name.startsWith("mcp__supaterm__");

export const hasTool = (tools: ReadonlyArray<ApiTool>, name: string) =>
  tools.some((tool) => tool.name === name);

const CODEX_NAMES: Readonly<Record<string, string>> = {
  exec_command: "Bash",
  shell_command: "Bash",
  shell: "Bash",
  spawn_agent: "Agent",
  apply_patch: "Edit",
  write_stdin: "write_stdin",
  web__run: "WebFetch",
};

export const normalizeToolName = (name: string) => {
  const bare = name.slice(name.lastIndexOf(".") + 1);
  return isSupatermName(bare)
    ? bare.slice(Supaterm_PREFIX.length)
    : (CODEX_NAMES[bare] ?? bare.slice(bare.lastIndexOf("_") + 1));
};

export const normalizeToolInput = (name: string, input: unknown) =>
  normalizeToolName(name) === "Bash" && isRecord(input)
    ? { ...input, command: input.command ?? input.cmd }
    : typeof input === "string" && normalizeToolName(name) === "Edit"
      ? { patch: input }
      : input;

const recordedCall = (step: number, use: typeof ToolUse.Type): Call => {
  const tool = normalizeToolName(use.name);
  const input = normalizeToolInput(use.name, use.input);
  const claudeAgent = tool === "Agent" && !use.name.endsWith("spawn_agent") && isRecord(input);
  return {
    step,
    tool,
    input: claudeAgent ? { run_in_background: true, ...input } : input,
    id: use.id,
  };
};

export const settle = (call: Call | undefined, result: Block) => {
  if (call !== undefined) {
    call.failed = result.is_error === true;
    call.output = valueText(result.content);
  }
  return result;
};

export const ranCalls = (
  { base, tools }: { readonly base: Base; readonly tools: ReadonlyArray<ApiTool> },
  step: number,
  uses: ReadonlyArray<typeof ToolUse.Type>,
) =>
  uses
    .values()
    .filter((use) => base.codex !== undefined || hasTool(tools, use.name))
    .map((use) => recordedCall(step, use))
    .toArray();
