import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type ApiTool, type MessagesRequest, type Config, ApiResponse } from "./types.ts";
import { type Model, MODELS } from "./models.ts";
import { visibleSupatermTools, supatermSystemAppend } from "./prompts.ts";
import { texts, isSupatermName, NEUTRAL_IDENTITY, text } from "./protocol.ts";
import { type Sample } from "./world.ts";
import { postModel } from "./transport.ts";

const RUNTIME_MARKER = "<runtime_info>";

const DEFERRED_LIST =
  /(The following deferred tools are now available via ToolSearch\.[^\n]*\n)((?:[^\n]+\n)*)/;

const MODEL_LINE = /You are powered by the model named .+?\. The exact model ID is [\w.-]+\./;

const IDENTITY =
  /You are Claude Code, Anthropic's official CLI for Claude(?:, running within the Claude Agent SDK)?\./g;

const stringProperty = (description: string) => ({ type: "string", description });

const NATIVE_SCHEMAS: Readonly<Record<string, Omit<ApiTool, "name">>> = {
  WebFetch: {
    description: "Fetches content from a URL and answers the prompt about it.",
    input_schema: {
      type: "object",
      properties: {
        url: stringProperty("The URL to fetch"),
        prompt: stringProperty("What to extract"),
      },
      required: ["url", "prompt"],
    },
  },
  WebSearch: {
    description: "Searches the web and returns result titles, links, and snippets.",
    input_schema: {
      type: "object",
      properties: { query: stringProperty("The search query") },
      required: ["query"],
    },
  },
};

export const buildBase = (
  template: typeof MessagesRequest.Type,
  options: {
    readonly model: Model;
    readonly keepUserInstructions: boolean;
    readonly subagent?: boolean;
    readonly links?: boolean;

    readonly nativeSubagent?: boolean;

    readonly deviceAccess?: boolean;
  },
) => {
  const supaterm = visibleSupatermTools(options);
  const firstAssistant = template.messages.findIndex((message) => message.role === "assistant");
  const head = template.messages.slice(0, firstAssistant === -1 ? undefined : firstAssistant);
  const systemTexts = [
    template.system ?? [],
    ...head.flatMap((m) => (m.role === "system" ? [m.content] : [])),
  ]
    .flatMap(texts)
    .filter((value) => !value.startsWith("x-anthropic-billing-header:"));
  const deferredList = DEFERRED_LIST.exec(systemTexts.join("\n"))?.[2];
  if (systemTexts.filter((value) => value.includes(RUNTIME_MARKER)).length !== 1 || !deferredList) {
    throw new Error(`The template needs one ${RUNTIME_MARKER} block and a deferred tool list.`);
  }
  const nativeDeferred = deferredList.split("\n").filter((name) => name && !isSupatermName(name));
  const names = [...nativeDeferred, ...supaterm.map((tool) => tool.name)].toSorted().join("\n");
  const { model } = options;
  const append = options.nativeSubagent ? "" : supatermSystemAppend(model, options.deviceAccess);
  const modelLine = `You are powered by the model named ${MODELS[model]}. The exact model ID is ${model}.`;
  const joined = systemTexts.join("\n");

  const cwd = /Primary working directory: (\S+)/.exec(joined)?.[1] ?? "/home/user/app";
  const home = /^\/(?:home|Users)\/[^/]+/.exec(cwd)?.[0];
  const anonymize = (value: string) =>
    home === undefined ? value : value.replaceAll(home, home.replace(/[^/]+$/, "user"));
  const system = systemTexts.map((value) => {
    const at = value.indexOf(RUNTIME_MARKER);
    return anonymize(at === -1 ? value : value.slice(0, at) + append)
      .replace(DEFERRED_LIST, (_, header: string) => `${header}${names}\n`)
      .replace(MODEL_LINE, modelLine)
      .replace(IDENTITY, NEUTRAL_IDENTITY);
  });
  const [first] = template.messages;

  const reminders = (first?.role === "user" ? texts(first.content).slice(0, -1) : []).filter(
    (value) =>
      options.keepUserInstructions || !value.includes("Codebase and user instructions are"),
  );

  const gitStatusAt = reminders.findIndex((value) => value.includes("# gitStatus"));

  const open = { type: "object", additionalProperties: true };
  const nativeSchema = (name: string) =>
    NATIVE_SCHEMAS[name] ?? { description: name, input_schema: open };
  return {
    model,
    system: system.map(text),
    reminders: reminders.filter((_, i) => i !== gitStatusAt).map((value) => text(anonymize(value))),
    gitStatusAt: gitStatusAt === -1 ? reminders.length : gitStatusAt,

    environment: {
      cwd: anonymize(cwd),
      platform: /Platform: (\w+)/.exec(joined)?.[1] ?? "linux",
      date: /Today's date is ([\d-]+)/.exec(reminders.join("\n"))?.[1],
    },
    nativeTools: template.tools.filter((tool) => !isSupatermName(tool.name)),

    supaterm,
    deferred: [...supaterm, ...nativeDeferred.map((name) => ({ name, ...nativeSchema(name) }))],
  };
};

export const requestBody = ({ base, tools }: Sample, effort: string, messages: unknown) => ({
  model: base.model,
  max_tokens: 16_000,
  thinking: { type: "adaptive", display: "summarized" },
  output_config: { effort },
  cache_control: { type: "ephemeral" },

  system: base.system.map((block, i) =>
    i === base.system.length - 1 ? { ...block, cache_control: { type: "ephemeral" } } : block,
  ),
  tools,
  messages,
});

export const callModel = (apiKey: string, body: unknown, proxy?: Config["proxy"]) =>
  postModel(apiKey, body, proxy).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ApiResponse))),
  );
