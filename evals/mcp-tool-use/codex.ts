import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { buildCodexAdditionalContext } from "../../apps/server/src/provider/CodexDeveloperInstructions.ts";
import {
  type ResponsesRequest,
  type Base,
  type Block,
  type ApiTool,
  type ApiMessage,
  AnyBlock,
  type Config,
} from "./types.ts";
import { type Model } from "./models.ts";
import { visibleSupatermTools } from "./prompts.ts";
import { valueText, isRecord, text } from "./protocol.ts";
import { postModel } from "./transport.ts";

export const buildCodexBase = (
  template: typeof ResponsesRequest.Type,
  options: {
    readonly model: Model;
    readonly keepUserInstructions: boolean;
    readonly effort?: string | undefined;
    readonly subagent?: boolean;
    readonly links?: boolean;

    readonly deviceAccess?: boolean;
  },
): Base => {
  const supaterm = visibleSupatermTools(options);
  const contentText = (item: Block) =>
    Array.isArray(item.content)
      ? item.content.map((block: Block) => valueText(block.text)).join("\n")
      : valueText(item.content);
  const joined = template.input.map(contentText).join("\n");
  if (!joined.includes("<supaterm_runtime>"))
    throw new Error("Codex template needs full Supaterm context.");
  const cwd = /<cwd>(.*?)<\/cwd>/.exec(joined)?.[1] ?? "/home/user/app";
  const home = /^\/(?:home|Users)\/[^/]+/.exec(cwd)?.[0];
  const clean = (s: string) => (home ? s.replaceAll(home, home.replace(/[^/]+$/, "user")) : s);
  const effort = options.effort ?? template.reasoning.effort;
  const message = (value: string, role = "developer") => ({
    type: "message",
    role,
    content: [{ type: "input_text", text: value }],
  });

  const input = template.input.flatMap((item) => {
    const content = contentText(item);
    if (content.includes("<supaterm_")) return [];
    if (item.role === "user") {
      const env = /<environment_context>[\s\S]*?<\/environment_context>/.exec(content)?.[0];
      return env ? [message(clean(options.keepUserInstructions ? content : env), "user")] : [];
    }

    if (item.type !== "message" && item.type !== "additional_tools") return [];
    if (item.role === "assistant") return [];
    return [JSON.parse(clean(JSON.stringify(item))) as Block];
  });
  const context = buildCodexAdditionalContext(
    { model: options.model, reasoningEffort: effort },
    { browser: true, device: options.deviceAccess ?? true },
  );
  input.push(
    ...Object.entries(context).map(([key, entry]) => message(`<${key}>${entry.value}</${key}>`)),
  );
  const nativeTools = input
    .flatMap((item) =>
      item.type === "additional_tools" && Array.isArray(item.tools)
        ? item.tools.flatMap((ns: unknown) =>
            isRecord(ns) && Array.isArray(ns.tools) ? ns.tools : [],
          )
        : [],
    )
    .filter((tool): tool is ApiTool => isRecord(tool) && typeof tool.name === "string");
  if (!nativeTools.some((tool) => tool.name === "exec"))
    throw new Error("Codex template needs code-mode exec.");
  return {
    model: options.model,
    system: [],
    reminders: [],
    gitStatusAt: 0,
    environment: {
      cwd: clean(cwd),
      platform: cwd.startsWith("/Users/") ? "darwin" : "linux",
      date: /<current_date>(.*?)<\/current_date>/.exec(joined)?.[1],
    },
    nativeTools,
    supaterm,
    deferred: [...supaterm],
    codex: { ...template, input, reasoning: { ...template.reasoning, effort } },
  };
};

const codexCall = (name: string, input: unknown) => {
  const args = isRecord(input) ? input : {};
  if (name === "Bash")
    return `text(await tools.exec_command(${JSON.stringify({ ...args, cmd: args.command })}));`;
  if (["Read", "Write", "Edit"].includes(name)) {
    const file = valueText(args.file_path);
    const command =
      name === "Read"
        ? `cat ${JSON.stringify(file)}`
        : name === "Write"
          ? `cat > ${JSON.stringify(file)} <<'EVAL_EOF'\n${valueText(args.content)}\nEVAL_EOF`
          : `python3 -c ${JSON.stringify(`from pathlib import Path; p=Path(${JSON.stringify(file)}); p.write_text(p.read_text().replace(${JSON.stringify(args.old_string)}, ${JSON.stringify(args.new_string)}))`)}`;
    return `text(await tools.exec_command(${JSON.stringify({ cmd: command })}));`;
  }
  return `text(await tools.${name.replace("mcp__supaterm__", "mcp__supaterm__")}(${JSON.stringify(input)}));`;
};

export const codexMessages = (messages: ReadonlyArray<ApiMessage>): Array<Block> =>
  messages.flatMap((message) =>
    message.content.map((block): Block =>
      block.type === "tool_use"
        ? {
            type: "custom_tool_call",
            call_id: block.id,
            name: "exec",
            input: codexCall(valueText(block.name), block.input),
          }
        : block.type === "tool_result"
          ? {
              type: "custom_tool_call_output",
              call_id: block.tool_use_id,
              output: valueText(block.content),
            }
          : {
              type: "message",
              role: message.role,
              content: [
                {
                  type: message.role === "user" ? "input_text" : "output_text",
                  text: valueText(block.text),
                },
              ],
            },
    ),
  );

export const codexRequest = (base: Base, input: ReadonlyArray<Block>) => ({
  model: base.model,
  stream: true,
  store: false,
  parallel_tool_calls: true,
  reasoning: base.codex?.reasoning,
  instructions: base.codex?.instructions,
  text: base.codex?.text,
  tool_choice: base.codex?.tool_choice,
  include: ["reasoning.encrypted_content"],
  input: [...(base.codex?.input ?? []), ...input],
});

export const codexCatalog = (base: Base) => [
  ...base.supaterm.map((tool) => ({
    name: tool.name.replace("mcp__supaterm__", "mcp__supaterm__"),
    description: `${valueText(tool.description)}\nInput JSON schema: ${JSON.stringify(tool.input_schema)}`,
  })),
  ...[
    ...valueText(base.nativeTools.find((tool) => tool.name === "exec")?.description).matchAll(
      /### `([^`]+)`/g,
    ),
  ].map((match) => ({ name: match[1]!, description: match[1]! })),
];

const CodexResponse = Schema.Struct({
  output: Schema.Array(AnyBlock),
  usage: Schema.Struct({
    input_tokens: Schema.Number,
    output_tokens: Schema.Number,
    input_tokens_details: Schema.Struct({ cached_tokens: Schema.Number }),
  }),
});

const decodeCodexResponse = Schema.decodeUnknownEffect(CodexResponse);

export const callCodex = Effect.fn("evaluateMcpToolUse.callCodex")(function* (
  config: Config,
  body: unknown,
) {
  const raw = yield* postModel("", body, config.proxy, true);
  const completed = raw
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
    .find((event) => event.type === "response.completed");
  if (!completed)
    return yield* Effect.die(new Error("Responses stream ended without response.completed."));
  const response = yield* decodeCodexResponse(completed.response);
  return {
    raw: response.output,
    content: response.output.flatMap((item): Array<Block> => {
      if (item.type === "message" && Array.isArray(item.content))
        return item.content.map((part: Block) => text(valueText(part.text)));
      if (item.type === "function_call" || item.type === "custom_tool_call")
        return [
          {
            type: "tool_use",
            id: item.call_id,
            name: item.name,
            input:
              item.type === "custom_tool_call" ? item.input : JSON.parse(valueText(item.arguments)),
          },
        ];
      return [];
    }),
    stop_reason: response.output.some(
      (item) => item.type.endsWith("tool_call") || item.type === "function_call",
    )
      ? "tool_use"
      : "end_turn",
    usage: {
      ...response.usage,
      input_tokens: response.usage.input_tokens - response.usage.input_tokens_details.cached_tokens,
      cache_read_input_tokens: response.usage.input_tokens_details.cached_tokens,
    },
  };
});
