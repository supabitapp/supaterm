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
        : runtime.driver === "kiro"
          ? "Kiro"
          : runtime.driver === "acpRegistry"
            ? "acpRegistry"
            : runtime.driver === "muse"
              ? "Muse Code"
              : runtime.driver === "fx"
                ? "fx"
                : undefined;
  if (harness === undefined) return transcript;
  const instructions = buildRuntimeInstructions({ harness, model: runtime.model });
  const sessionModels = new Map<unknown, string>();
  const notesFor = (sessionId: unknown) => {
    const model = sessionModels.get(sessionId) ?? runtime.model;
    return model === runtime.model ? instructions : buildRuntimeInstructions({ harness, model });
  };
  const compactsThroughPrompt = runtime.driver === "grok";
  const deliveredNotes = new Map<unknown, string>();
  const compactionCounts = new Map<unknown, number>();
  const completedCompactionIds = new Set<string>();
  const openCompactions = new Map<unknown, Set<unknown>>();
  const markCompacted = (sessionId: unknown, compactionId?: unknown) => {
    if (typeof compactionId === "string") {
      const key = `${String(sessionId)}\u0000${compactionId}`;
      if (completedCompactionIds.has(key)) return;
      completedCompactionIds.add(key);
    }
    deliveredNotes.delete(sessionId);
    compactionCounts.set(sessionId, (compactionCounts.get(sessionId) ?? 0) + 1);
  };
  let pendingPrompt:
    | {
        readonly sessionId: unknown;
        readonly notes: string | undefined;
        readonly compact: boolean;
        readonly compactionsAtSend: number;
      }
    | undefined;
  let pendingKiroCompact: { readonly sessionId: unknown } | undefined;

  return {
    ...transcript,
    entries: transcript.entries.map((entry) => {
      if (entry.type === "emit_inbound") {
        const frame = asFrame(entry.frame);
        if (frame?.kind === "response" && frame.method === "session/prompt" && pendingPrompt) {
          const stopReason = isRecord(frame.result) ? frame.result.stopReason : undefined;
          const delivered =
            frame.error === undefined &&
            stopReason !== "cancelled" &&
            stopReason !== "refusal" &&
            stopReason !== "error";
          const open = openCompactions.get(pendingPrompt.sessionId);
          if (delivered && open !== undefined && open.size > 0) {
            openCompactions.delete(pendingPrompt.sessionId);
            markCompacted(pendingPrompt.sessionId);
          }
          if (delivered && pendingPrompt.compact) {
            markCompacted(pendingPrompt.sessionId);
          } else if (
            delivered &&
            pendingPrompt.notes !== undefined &&
            (compactionCounts.get(pendingPrompt.sessionId) ?? 0) === pendingPrompt.compactionsAtSend
          ) {
            deliveredNotes.set(pendingPrompt.sessionId, pendingPrompt.notes);
          }
          pendingPrompt = undefined;
        }
        if (
          frame?.kind === "response" &&
          frame.method === "_kiro/session/compact" &&
          pendingKiroCompact
        ) {
          if (isRecord(frame.result) && frame.result.success === true) {
            markCompacted(pendingKiroCompact.sessionId);
          }
          pendingKiroCompact = undefined;
        }
        const update =
          frame?.method === "session/update" && isRecord(frame.params)
            ? frame.params.update
            : undefined;
        if (
          isRecord(update) &&
          update.sessionUpdate === "compaction_update" &&
          isRecord(frame?.params)
        ) {
          const sessionId = frame.params.sessionId;
          const open = openCompactions.get(sessionId) ?? new Set<unknown>();
          if (update.status === "in_progress") {
            openCompactions.set(sessionId, open.add(update.compactionId));
          } else {
            open.delete(update.compactionId);
          }
          if (update.status === "completed") markCompacted(sessionId, update.compactionId);
        }
        return entry;
      }
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
        (frame.method === "session/close" || frame.method === "initialize")
      ) {
        deliveredNotes.clear();
        completedCompactionIds.clear();
        openCompactions.clear();
        pendingPrompt = undefined;
        pendingKiroCompact = undefined;
        return entry;
      }
      const params = "params" in frame && isRecord(frame.params) ? frame.params : undefined;
      const selectedModel =
        "method" in frame && frame.method === "session/set_config_option"
          ? params?.configId === "model"
            ? params.value
            : undefined
          : "method" in frame && frame.method === "session/set_model"
            ? params?.modelId
            : undefined;
      if (typeof selectedModel === "string") {
        sessionModels.set(params?.sessionId, selectedModel);
        return entry;
      }
      if (
        "method" in frame &&
        frame.method === "_kiro/session/compact" &&
        "params" in frame &&
        typeof frame.params === "object" &&
        frame.params !== null &&
        "sessionId" in frame.params
      ) {
        pendingKiroCompact = { sessionId: frame.params.sessionId };
        return entry;
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
        const promptSessionId = "sessionId" in frame.params ? frame.params.sessionId : undefined;
        const prompt: ReadonlyArray<unknown> = frame.params.prompt;
        const firstText = promptPartText(prompt[0])?.trim();
        if (firstText?.startsWith("/") === true) {
          pendingPrompt = {
            sessionId: promptSessionId,
            notes: undefined,
            compact:
              compactsThroughPrompt && prompt.length === 1 && /^\/compact(?:\s|$)/.test(firstText),
            compactionsAtSend: compactionCounts.get(promptSessionId) ?? 0,
          };
          return entry;
        }
        const lastText = promptPartText(prompt.at(-1));
        const expected = notesFor(promptSessionId);
        const recordedNotes =
          lastText === expected || lastText?.startsWith("<runtime_info>") === true
            ? lastText
            : undefined;
        const resend =
          recordedNotes === undefined && deliveredNotes.get(promptSessionId) !== expected;
        pendingPrompt = {
          sessionId: promptSessionId,
          notes: recordedNotes !== undefined || resend ? expected : undefined,
          compact: false,
          compactionsAtSend: compactionCounts.get(promptSessionId) ?? 0,
        };
        if (!resend) return entry;
        return {
          ...entry,
          frame: {
            ...frame,
            params: { ...frame.params, prompt: [...prompt, { type: "text", text: expected }] },
          },
        };
      }
      return entry;
    }),
  };
}

function promptPartText(part: unknown): string | undefined {
  return typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "text" &&
    "text" in part &&
    typeof part.text === "string"
    ? part.text
    : undefined;
}

type ReplayFrame = {
  readonly kind?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asFrame(value: unknown): ReplayFrame | undefined {
  return isRecord(value) ? value : undefined;
}
