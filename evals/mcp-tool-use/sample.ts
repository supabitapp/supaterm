import { providerAdapter } from "./providers.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { HttpClient } from "effect/http";
import {
  type McpToolUseCase,
  type Config,
  type Base,
  type Usage,
  type Call,
  isText,
  isToolUse,
  decodeJson,
} from "./types.ts";
import { makeSample, withDevices, buildMessages, answerToolCall } from "./world.ts";
import { codexMessages, codexCatalog } from "./codex.ts";
import { isCodex } from "./models.ts";
import {
  addUsage,
  ranCalls,
  settle,
  normalizeToolName,
  normalizeToolInput,
  valueText,
  isSupatermName,
  text,
  toolResult,
  TOOL_LOADED,
} from "./protocol.ts";
import { failedEarly } from "./grade.ts";
import { executeCodex } from "./code-cell.ts";

export const runSample = Effect.fn("evaluateMcpToolUse.runSample")(function* (
  testCase: McpToolUseCase,
  config: Config,
  base: Base,
  spent: { readonly usage: Usage; readonly shellUsage: Usage },
) {
  const adapter = providerAdapter(config.model);
  const sample = { ...makeSample(testCase, base), shellUsage: spent.shellUsage };
  yield* withDevices(sample);
  const runPromise = Effect.runPromiseWith(yield* Effect.context<HttpClient.HttpClient>());
  const messages = buildMessages(sample);
  const input = base.codex ? codexMessages(messages) : undefined;
  const transcript: Array<unknown> = [];
  const start = messages.length;
  const calls: Array<Call> = [];
  const said: Array<string> = [];
  const { usage } = spent;
  let stopReason = "max_steps";
  let finalText = "";

  const extra = isCodex(config.model) ? 4 : 0;
  const maxSteps = testCase.maxSteps === undefined ? config.maxSteps : testCase.maxSteps + extra;
  for (let step = 0; step < maxSteps; step++) {
    const response = yield* adapter.call(
      config,
      adapter.request(sample, config.effort, messages, input),
    );
    addUsage(usage, response.usage);
    if (response.raw) {
      input?.push(...response.raw);
      transcript.push(...response.raw);
    }
    messages.push({ role: "assistant", content: response.content });
    const texts = response.content.filter(isText).map((block) => block.text);
    said.push(...texts);
    const uses = response.content.filter(isToolUse);
    calls.push(...ranCalls(sample, step, uses));
    if (response.stop_reason !== "tool_use") {
      stopReason = response.stop_reason ?? "unknown";
      finalText = texts.join("\n\n");
      break;
    }
    if (failedEarly(testCase.expect, { calls, text: said.join("\n\n"), stopReason })) {
      stopReason = "failed_early";
      break;
    }
    const results = yield* Effect.forEach(uses, (use) =>
      Effect.gen(function* () {
        const own = calls.find((call) => call.id === use.id);
        if (!input) {
          return settle(own, yield* answerToolCall(sample, config, use));
        }
        const answer = (name: string, args: unknown, record = true) => {
          const tool = normalizeToolName(name);
          const normalized = normalizeToolInput(name, args);

          let recorded = own;
          if (record) {
            recorded = { step, tool, input: normalized };
            calls.push(recorded);
          }
          const call = { ...use, name, input: normalized };
          return answerToolCall(sample, config, call).pipe(
            Effect.map((result) => settle(recorded, result)),
            Effect.map((result) => {
              const output = valueText(result.content);
              if (isSupatermName(name))
                return {
                  content: [text(output)],
                  ...(!result.is_error
                    ? { structuredContent: Option.getOrElse(decodeJson(output), () => output) }
                    : { isError: true }),
                };
              return tool === "Bash"
                ? {
                    output,
                    exit_code: /^Exit code [1-9]/.test(output) ? 1 : 0,
                    wall_time_seconds: 0,
                  }
                : output;
            }),
            runPromise,
          );
        };
        return yield* Effect.tryPromise(async () => {
          const output =
            use.name === "exec"
              ? await executeCodex(
                  valueText(use.input),
                  codexCatalog(base),
                  answer,
                  sample.codeStore,
                )
              : await answer(use.name, use.input, false);
          const item = {
            type: use.name === "exec" ? "custom_tool_call_output" : "function_call_output",
            call_id: use.id,
            output: valueText(output),
          };
          input.push(item);
          transcript.push(item);
          return toolResult(use.id, output);
        });
      }),
    );

    const loaded = results.some((result) => Array.isArray(result.content));
    messages.push({ role: "user", content: [...results, ...(loaded ? [text(TOOL_LOADED)] : [])] });
    if (failedEarly(testCase.expect, { calls, text: said.join("\n\n"), stopReason })) {
      stopReason = "failed_early";
      break;
    }
  }

  return {
    calls,
    text: said.join("\n\n"),
    stopReason,
    finalText,
    linked: [...sample.linked],
    ...(sample.devices ? { launchers: [...sample.devices.launchers] } : {}),
    usage,
    shellUsage: sample.shellUsage,
    transcript: input ? transcript : messages.slice(start),
  };
}, Effect.scoped);
