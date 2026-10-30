import type { ProviderDriverKind, ProviderReplayTranscript } from "@supaterm/contracts";

import { buildRuntimeInstructions } from "@supaterm/provider-core/server/runtimeInstructions";

export function materializeReplayTranscriptRuntimeInstructions(
  transcript: ProviderReplayTranscript,
  runtime: { readonly driver: ProviderDriverKind; readonly model: string },
): ProviderReplayTranscript {
  const harness =
    runtime.driver === "cursor"
      ? "Cursor"
      : runtime.driver === "grok"
        ? "Grok"
        : runtime.driver === "acpRegistry"
          ? "acpRegistry"
          : runtime.driver === "muse"
            ? "Muse Code"
            : undefined;
  if (harness === undefined) return transcript;
  const instructions = buildRuntimeInstructions({ harness, model: runtime.model });

  return {
    ...transcript,
    entries: transcript.entries.map((entry) => {
      if (entry.type !== "expect_outbound") return entry;
      const frame = entry.frame;
      if (typeof frame !== "object" || frame === null) return entry;
      if (
        runtime.driver === "muse" &&
        "method" in frame &&
        frame.method === "turn/start" &&
        "params" in frame &&
        typeof frame.params === "object" &&
        frame.params !== null &&
        "input" in frame.params &&
        Array.isArray(frame.params.input)
      ) {
        const firstPart: unknown = frame.params.input[0];
        if (
          typeof firstPart !== "object" ||
          firstPart === null ||
          !("text" in firstPart) ||
          typeof firstPart.text !== "string" ||
          !firstPart.text.startsWith("<runtime_info>")
        ) {
          return entry;
        }
        return {
          ...entry,
          frame: {
            ...frame,
            params: {
              ...frame.params,
              input: [
                {
                  ...firstPart,
                  text: buildRuntimeInstructions({
                    harness,
                    model: runtime.model,
                    reasoningEffort:
                      "reasoningEffort" in frame.params &&
                      typeof frame.params.reasoningEffort === "string"
                        ? frame.params.reasoningEffort
                        : undefined,
                  }),
                },
                ...frame.params.input.slice(1),
              ],
            },
          },
        };
      }
      if (
        runtime.driver === "cursor" &&
        "type" in frame &&
        frame.type === "run.start" &&
        "message" in frame &&
        typeof frame.message === "string"
      ) {
        return frame.message.endsWith(instructions)
          ? entry
          : { ...entry, frame: { ...frame, message: `${frame.message}\n\n${instructions}` } };
      }
      if (
        "method" in frame &&
        frame.method === "session/prompt" &&
        "params" in frame &&
        typeof frame.params === "object" &&
        frame.params !== null &&
        "prompt" in frame.params &&
        Array.isArray(frame.params.prompt)
      ) {
        const prompt: ReadonlyArray<unknown> = frame.params.prompt;
        const lastPart = prompt.at(-1);
        if (
          typeof lastPart === "object" &&
          lastPart !== null &&
          "type" in lastPart &&
          lastPart.type === "text" &&
          "text" in lastPart &&
          lastPart.text === instructions
        ) {
          return entry;
        }
        return {
          ...entry,
          frame: {
            ...frame,
            params: { ...frame.params, prompt: [...prompt, { type: "text", text: instructions }] },
          },
        };
      }
      return entry;
    }),
  };
}
