import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as HttpClient from "effect/http/HttpClient";
import { buildBase, callModel, requestBody } from "./claude.ts";
import { buildCodexBase, callCodex, codexMessages, codexRequest } from "./codex.ts";
import { isCodex, type Model } from "./models.ts";
import { supatermSubagentContext } from "./prompts.ts";
import {
  Capture,
  CodexCapture,
  type ApiMessage,
  type ApiResponse,
  type Base,
  type Block,
  type Config,
  type McpToolUseCase,
} from "./types.ts";
import type { Sample } from "./world.ts";

type CaptureOptions = {
  readonly model: Model;
  readonly role: McpToolUseCase["setup"]["role"];
  readonly keepUserInstructions: boolean;
  readonly deviceAccess: boolean;
  readonly links: boolean;
  readonly effort?: string | undefined;
};
type Request = ReturnType<typeof requestBody> | ReturnType<typeof codexRequest>;
type Response = typeof ApiResponse.Type & { readonly raw?: ReadonlyArray<Block> };
type RequestError =
  | Effect.Error<ReturnType<typeof callModel>>
  | Effect.Error<ReturnType<typeof callCodex>>;

interface ProviderAdapter {
  readonly capture: (
    source: string,
    options: CaptureOptions,
  ) => Effect.Effect<Base, Schema.SchemaError>;
  readonly request: (
    sample: Sample,
    effort: string,
    messages: ReadonlyArray<ApiMessage>,
    input?: ReadonlyArray<Block>,
  ) => Request;
  readonly call: (
    config: Config,
    request: Request,
  ) => Effect.Effect<Response, RequestError, HttpClient.HttpClient>;
}

const decodeCapture = Schema.decodeUnknownEffect(Schema.fromJsonString(Capture));
const decodeCodexCapture = Schema.decodeUnknownEffect(Schema.fromJsonString(CodexCapture));

const claude: ProviderAdapter = {
  capture: Effect.fn("evaluateMcpToolUse.captureClaude")(function* (source, options) {
    const capture = yield* decodeCapture(source);
    const base = buildBase(capture.request.provider_native, {
      ...options,
      subagent: options.role === "delegated-child",
      nativeSubagent: options.role === "native-subagent",
    });
    return options.role === "native-subagent"
      ? {
          ...base,
          subagentContext: yield* Effect.promise(() =>
            supatermSubagentContext(options.model, options.deviceAccess),
          ),
        }
      : base;
  }),
  request: (sample, effort, messages) => requestBody(sample, effort, messages),
  call: (config, request) => callModel(config.apiKey, request),
};

const codex: ProviderAdapter = {
  capture: Effect.fn("evaluateMcpToolUse.captureCodex")(function* (source, options) {
    const capture = yield* decodeCodexCapture(source);
    return buildCodexBase(capture.request.provider_native, {
      ...options,
      subagent: options.role === "delegated-child",
    });
  }),
  request: (sample, _effort, messages, input) =>
    codexRequest(sample.base, input ?? codexMessages(messages)),
  call: (config, request) => callCodex(config, request),
};

export const providerAdapter = (model: Model): ProviderAdapter => (isCodex(model) ? codex : claude);
