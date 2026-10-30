import {
  ComposerContextRecord,
  DeviceOperationError,
  DeviceSummary,
  OrchestratorMcpTaskRole,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { DeviceExpect } from "./device-grading.ts";
import { type PRICES, type PricedModel, type Model } from "./models.ts";

export type Block = { readonly type: string; readonly [key: string]: unknown };

export type ApiMessage = {
  readonly role: "user" | "assistant";
  readonly content: ReadonlyArray<Block>;
};

export type ApiTool = { readonly name: string; readonly [key: string]: unknown };

export type Usage = Record<keyof (typeof PRICES)[PricedModel], number>;

export type Call = {
  readonly step: number;
  readonly tool: string;
  readonly input: unknown;

  readonly id?: string;

  failed?: boolean;
  output?: string;
};

export type SampleRun = {
  readonly calls: ReadonlyArray<Call>;
  text: string;
  stopReason: string;

  readonly finalText?: string;

  readonly linked?: ReadonlyArray<string>;

  readonly launchers?: ReadonlyArray<string>;
};

const Rest = [Schema.Record(Schema.String, Schema.Unknown)] as const;

const PriorToolCall = Schema.Struct({
  tool: Schema.String,
  input: Schema.Unknown,

  result: Schema.Unknown,
});

export const McpToolUseCall = Schema.Struct({
  tool: Schema.String,
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

export type McpToolUseCall = typeof McpToolUseCall.Type;

const McpToolUseExpect = Schema.Struct({
  calls: Schema.optional(Schema.Array(McpToolUseCall)),

  callsMustNot: Schema.optional(Schema.Array(McpToolUseCall)),
  notCalls: Schema.optional(Schema.Array(Schema.String)),

  order: Schema.optional(Schema.Array(Schema.String)),
  minCalls: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  maxCalls: Schema.optional(Schema.Record(Schema.String, Schema.Number)),

  endsTurnAfter: Schema.optional(Schema.String),

  shellMustNot: Schema.optional(Schema.Array(Schema.String)),

  textMust: Schema.optional(Schema.Array(Schema.String)),
  textMustNot: Schema.optional(Schema.Array(Schema.String)),

  linked: Schema.optional(Schema.Array(Schema.String)),

  device: Schema.optional(DeviceExpect),
});

const McpToolUseWorld = Schema.StructWithRest(
  Schema.Struct({
    repo: Schema.optional(Schema.String),
    branch: Schema.optional(Schema.String),

    status: Schema.optional(Schema.String),

    commits: Schema.optional(
      Schema.Array(
        Schema.StructWithRest(Schema.Struct({ sha: Schema.String, subject: Schema.String }), Rest),
      ),
    ),

    devices: Schema.optional(Schema.Array(DeviceSummary)),

    deviceHosts: Schema.optional(Schema.Record(Schema.String, Schema.String)),

    agentDeviceSessions: Schema.optional(
      Schema.Record(Schema.String, Schema.Struct({ app: Schema.optional(Schema.String) })),
    ),

    deviceDiscoveryFailures: Schema.optional(Schema.Record(Schema.String, DeviceOperationError)),

    deviceAgentAccess: Schema.optional(Schema.Boolean),

    deviceInvalidCapture: Schema.optional(Schema.Boolean),

    deviceOwners: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
  Rest,
);

export const McpToolUseCase = Schema.Struct({
  id: Schema.String,
  area: Schema.String,
  kind: Schema.Literals(["bad", "guard", "control"]),
  pattern: Schema.String,
  experience: Schema.String,
  rule: Schema.optional(Schema.String),
  privacy: Schema.optional(Schema.Literals(["commit-safe", "private"])),
  setup: Schema.Struct({
    role: Schema.Literals(["top", "delegated-child", "native-subagent"]),

    harness: Schema.optional(Schema.Literals(["claude", "codex"])),

    linkedEnvironments: Schema.optional(Schema.Boolean),

    delegateRole: Schema.optional(OrchestratorMcpTaskRole),
    context: Schema.optional(Schema.String),
    priorTurns: Schema.optional(
      Schema.Array(
        Schema.Struct({
          role: Schema.Literals(["user", "assistant"]),
          text: Schema.optional(Schema.String),
          toolCalls: Schema.optional(Schema.Array(PriorToolCall)),
        }),
      ),
    ),
    world: Schema.optional(McpToolUseWorld),

    mocks: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),

    shellMocks: Schema.optional(
      Schema.Array(Schema.Struct({ match: Schema.String, output: Schema.String })),
    ),
  }),
  prompt: Schema.String,

  promptContext: Schema.optional(Schema.Struct({ records: Schema.Array(ComposerContextRecord) })),
  expect: McpToolUseExpect,

  maxSteps: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  notes: Schema.optional(Schema.String),
});

export type McpToolUseCase = typeof McpToolUseCase.Type;

export const AnyBlock = Schema.StructWithRest(
  Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
  Rest,
);

export const Content = Schema.Union([Schema.String, Schema.Array(AnyBlock)]);

export const MessagesRequest = Schema.Struct({
  system: Schema.optional(Content),
  messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Content })),
  tools: Schema.Array(Schema.StructWithRest(Schema.Struct({ name: Schema.String }), Rest)),
});

export const Capture = Schema.Struct({
  request: Schema.Struct({ provider_native: MessagesRequest }),
});

export const ResponsesRequest = Schema.StructWithRest(
  Schema.Struct({
    input: Schema.Array(AnyBlock),
    reasoning: Schema.StructWithRest(Schema.Struct({ effort: Schema.String }), Rest),
  }),
  Rest,
);

export const CodexCapture = Schema.Struct({
  request: Schema.Struct({ provider_native: ResponsesRequest }),
});

export const ToolUse = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
});

export const isToolUse = Schema.is(ToolUse);

export const isText = Schema.is(
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
);

const Count = Schema.optional(Schema.NullOr(Schema.Number));

export const ApiResponse = Schema.Struct({
  content: Schema.Array(AnyBlock),
  stop_reason: Schema.NullOr(Schema.String),
  usage: Schema.Struct({
    input_tokens: Schema.Number,
    output_tokens: Schema.Number,
    cache_creation_input_tokens: Count,
    cache_read_input_tokens: Count,
  }),
});

export type Base = {
  readonly model: Model;
  readonly system: ReadonlyArray<Block>;
  readonly reminders: ReadonlyArray<Block>;
  readonly gitStatusAt: number;
  readonly environment: {
    readonly cwd: string;
    readonly platform: string;
    readonly date?: string | undefined;
  };
  readonly nativeTools: ReadonlyArray<ApiTool>;
  readonly supaterm: ReadonlyArray<ApiTool>;
  readonly deferred: ReadonlyArray<ApiTool>;
  readonly codex?: typeof ResponsesRequest.Type;
  readonly subagentContext?: string;
};

export type Config = {
  readonly apiKey: string;
  readonly model: Model;
  readonly proxy?: { readonly url: string; readonly headers: Readonly<Record<string, string>> };
  readonly effort: string;
  readonly maxSteps: number;
  readonly shellModel: PricedModel;
};

export const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export type ResultRow = Pick<McpToolUseCase, "id" | "kind" | "pattern"> & {
  readonly role: string;
  readonly pass: boolean;

  readonly error?: string;
  readonly usage: Usage;
  readonly shellUsage: Usage;
};
