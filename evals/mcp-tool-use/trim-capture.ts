#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
   
                                                                                                   
                                                                                 
                                                                                      
   
import * as NodeFS from "node:fs";
import * as NodeZlib from "node:zlib";

type Block = { readonly text?: string; readonly [key: string]: unknown };
type Message = { readonly role?: string; content?: string | ReadonlyArray<Block> };
type Item = Message & { readonly [key: string]: unknown };
                                                                
type Native = {
  readonly system: ReadonlyArray<Block & { readonly text: string }>;
  readonly messages: ReadonlyArray<Item>;
  readonly tools: unknown;
  readonly input: ReadonlyArray<Item>;
  readonly [key: string]: unknown;
};

                                                                                                
const CLAUDE_SKILLS = new Set([
  "update-config",
  "keybindings-help",
  "code-review",
  "simplify",
  "fewer-permission-prompts",
  "loop",
  "claude-api",
  "workflow-authoring",
  "run",
  "plugin-authoring",
  "init",
  "security-review",
]);
const CLAUDE_AGENTS = new Set(["Explore", "general-purpose", "Plan", "statusline-setup"]);
                                                                                        
const USER_SKILL_LINE = /^- `r[02]` = |\(file: r[02]\//;
                                                                                             
const CODEX_MODELS = new Set(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"]);

                                                                      
const trimModelList = (tool: unknown): unknown => {
  if (Array.isArray(tool)) return tool.map(trimModelList);
  if (typeof tool !== "object" || tool === null) return tool;
  return Object.fromEntries(
    Object.entries(tool).map(([key, value]) => [
      key,
      key === "description" && typeof value === "string" && value.includes("model overrides")
        ? value
            .split("\n")
            .flatMap((line) => {
              const id = /^- `([\w.-]+)`: /.exec(line)?.[1];
              if (id === undefined) return [line];
              return CODEX_MODELS.has(id) ? [`- \`${id}\``] : [];
            })
            .join("\n")
        : trimModelList(value),
    ]),
  );
};

                                                                                                
const keepEntries = (text: string, header: string, keep: ReadonlySet<string>) => {
  const start = text.indexOf(header) + header.length;
  const end = text.indexOf("\n\n", text.indexOf("\n- ", start));
  let keeping = true;
  const lines = text
    .slice(start, end)
    .split("\n")
    .filter((line) => {
      const name = /^- ([\w.-]+): /.exec(line)?.[1];
      if (name !== undefined) keeping = keep.has(name);
      return keeping || line === "";
    });
  return text.slice(0, start) + lines.join("\n") + text.slice(end);
};

const trimClaude = (native: Native) => {
  const firstAssistant = native.messages.findIndex((message) => message.role === "assistant");
  const head = structuredClone(
    native.messages.slice(0, firstAssistant === -1 ? undefined : firstAssistant),
  );
  const [first] = head;
  if (!first || !Array.isArray(first.content))
    throw new Error("The capture has no first user turn.");
  const blocks = (first.content as ReadonlyArray<Block>).flatMap((block) => {
                                                                                    
    if (block.type !== "text") return [];
    const text = block.text ?? "";
                                  
    if (text.includes("Codebase and user instructions are")) return [];
    if (!text.includes("# gitStatus")) return [block];
                                                          
    return [
      { ...block, text: "<system-reminder>\n# gitStatus\n(Set by each case.)\n</system-reminder>" },
    ];
  });
  blocks[blocks.length - 1] = { ...blocks.at(-1), text: "(Set by each case.)" };
  first.content = blocks;
  for (const message of head.slice(1)) {
    if (typeof message.content !== "string") continue;
    let text = message.content;
                                                                
    const runtime = text.indexOf("<runtime_info>");
    if (runtime !== -1) text = text.slice(0, runtime + "<runtime_info>".length);
    const agents = "Available agent types for the Agent tool:\n";
    if (text.includes(agents)) text = keepEntries(text, agents, CLAUDE_AGENTS);
    const skills = /The following skills are available[^\n]*\n\n/.exec(text)?.[0];
    if (skills) text = keepEntries(text, skills, CLAUDE_SKILLS);
    message.content = text;
  }
  const system = native.system.filter(
    (block) => !block.text.startsWith("x-anthropic-billing-header:"),
  );
  return { system, messages: head, tools: native.tools };
};

const textOf = ({ content }: Item) =>
  Array.isArray(content) ? content.map((block: Block) => block.text ?? "").join("\n") : "";

const trimCodex = (native: Native) => {
  const input = native.input.flatMap(({ id: _id, ...item }): Array<Item> => {
                                                                                
    if (item.type !== "message" && item.type !== "additional_tools") return [];
    if (item.role === "assistant") return [];
    const text = textOf(item);
                                                                            
    if (text.includes("<supaterm_")) return [];
    if (item.role === "user") {
      const env = /<environment_context>[\s\S]*?<\/environment_context>/.exec(text)?.[0];
      return env ? [{ ...item, content: [{ type: "input_text", text: env }] }] : [];
    }
    if (item.type === "additional_tools") return [{ ...item, tools: trimModelList(item.tools) }];
    if (!text.includes("<skills_instructions>")) return [item];
    const content = (item.content as ReadonlyArray<Block>).map((block) =>
      typeof block.text === "string"
        ? {
            ...block,
            text: block.text
              .split("\n")
              .filter((line: string) => !USER_SKILL_LINE.test(line))
              .join("\n"),
          }
        : block,
    );
    return [{ ...item, content }];
  });
                                                        
  input.push({
    type: "message",
    role: "developer",
    content: [{ type: "input_text", text: "<supaterm_runtime></supaterm_runtime>" }],
  });
  const { reasoning, instructions, text, tool_choice } = native;
  return { reasoning, instructions, text, tool_choice, input };
};

const [harness, capturePath, outPath] = process.argv.slice(2);
if ((harness !== "claude" && harness !== "codex") || !capturePath || !outPath) {
  throw new Error("Usage: trim-capture.ts <claude|codex> <capture.json> <out.json.gz>");
}
const native: Native = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")).request.provider_native;
const raw = JSON.stringify({
  request: { provider_native: harness === "claude" ? trimClaude(native) : trimCodex(native) },
});
                                                      
const user = /\/(?:home|Users)\/([^/\s"\\]+)/.exec(raw)?.[1];
const body = user ? raw.replace(new RegExp(`/(home|Users)/${user}\\b`, "g"), "/$1/user") : raw;
const leak = new RegExp(
  `account_uuid|device_id|account_hmac|chatgpt-account${user && user !== "user" ? `|\\b${user}\\b` : ""}`,
  "i",
).exec(body);
if (leak)
  throw new Error(`User data is left near: ${body.slice(leak.index - 60, leak.index + 60)}`);
NodeFS.writeFileSync(outPath, NodeZlib.gzipSync(body));
process.stdout.write(`Wrote ${outPath}. Read it for personal data before you commit.\n`);
