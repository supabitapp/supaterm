import type { RunId, ThreadId } from "@supaterm/contracts";
import type * as ProviderAdapter from "@supaterm/provider-core/server/ProviderAdapter";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export type PromptSuggestionEvent = Extract<
  ProviderAdapter.ProviderAdapterV2Event,
  { readonly type: "prompt_suggestion.expected" | "prompt_suggestion.ready" }
>;

interface PromptSuggestionTarget {
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

// Claude sends its prediction a couple of seconds after the turn ends, and nothing at all when
// it declines to predict (a first turn, plan mode, near a usage limit), so the wait is bounded.
const PREDICTION_WAIT = Duration.seconds(20);
const CAPACITY = 256;

export class PromptSuggestionHub extends Context.Service<
  PromptSuggestionHub,
  {
    readonly offer: (event: PromptSuggestionEvent) => Effect.Effect<void>;
    /**
     * None when the run's provider does not predict next prompts. Otherwise its prediction, or
     * null when it declined to make one.
     */
    readonly await: (target: PromptSuggestionTarget) => Effect.Effect<Option.Option<string | null>>;
  }
>()("supaterm/orchestration-v2/PromptSuggestionHub") {}

const make = Effect.sync(() => {
  const predictions = new Map<string, Deferred.Deferred<string>>();
  const keyOf = (target: PromptSuggestionTarget) => `${target.threadId}\u0000${target.runId}`;
  const prediction = (key: string) => {
    const existing = predictions.get(key);
    if (existing !== undefined) return existing;
    const created = Deferred.makeUnsafe<string>();
    predictions.set(key, created);
    if (predictions.size > CAPACITY) predictions.delete(predictions.keys().next().value!);
    return created;
  };

  return PromptSuggestionHub.of({
    offer: Effect.fn("PromptSuggestionHub.offer")(function (event) {
      return Effect.suspend(() => {
        const pending = prediction(keyOf(event));
        return event.type === "prompt_suggestion.ready"
          ? Deferred.succeed(pending, event.suggestion).pipe(Effect.asVoid)
          : Effect.void;
      });
    }),
    await: Effect.fn("PromptSuggestionHub.await")(function (target) {
      return Effect.suspend(() => {
        const pending = predictions.get(keyOf(target));
        if (pending === undefined) return Effect.succeedNone;
        return Deferred.await(pending).pipe(
          Effect.timeoutOption(PREDICTION_WAIT),
          Effect.map((text) => Option.some(Option.getOrNull(text))),
        );
      });
    }),
  });
});

export const layer = Layer.effect(PromptSuggestionHub, make);
