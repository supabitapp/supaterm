import type { OrchestrationV2PromptSuggestion, ThreadId } from "@supaterm/contracts";
import type * as ProviderAdapter from "@supaterm/provider-core/server/ProviderAdapter";
import { sanitizeNextPrompt } from "@supaterm/provider-core/server/textGenerationUtils";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ProjectionStore from "./ProjectionStore.ts";

export type PromptSuggestionEvent = Extract<
  ProviderAdapter.ProviderAdapterV2Event,
  { readonly type: "prompt_suggestion.updated" }
>;

type StoredSuggestion = NonNullable<OrchestrationV2PromptSuggestion>;

const CAPACITY = 256;

/**
 * Keeps each thread's latest predicted next prompt in memory and pushes it to clients showing
 * that thread. Clients offer it only while its run is still the thread's latest completed run.
 */
export class PromptSuggestionHub extends Context.Service<
  PromptSuggestionHub,
  {
    readonly offer: (event: PromptSuggestionEvent) => Effect.Effect<void>;
    readonly subscribe: (threadId: ThreadId) => Stream.Stream<OrchestrationV2PromptSuggestion>;
  }
>()("supaterm/orchestration-v2/PromptSuggestionHub") {}

const make = Effect.gen(function* () {
  const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
  const store = yield* SubscriptionRef.make<ReadonlyMap<ThreadId, StoredSuggestion>>(new Map());

  return PromptSuggestionHub.of({
    offer: Effect.fn("PromptSuggestionHub.offer")(function* (event) {
      const text = sanitizeNextPrompt(event.text);
      if (text === null) return;
      yield* SubscriptionRef.update(store, (current) => {
        const next = new Map(current);
        next.delete(event.threadId);
        next.set(event.threadId, { runId: event.runId, text });
        for (const threadId of next.keys()) {
          if (next.size <= CAPACITY) break;
          next.delete(threadId);
        }
        return next;
      });
    }),
    // Stored suggestions can outlive a deleted thread, so check the thread before serving one.
    subscribe: (threadId) =>
      SubscriptionRef.changes(store).pipe(
        Stream.map((suggestions) => suggestions.get(threadId) ?? null),
        Stream.changes,
        Stream.mapEffect((suggestion) =>
          suggestion === null
            ? Effect.succeed(null)
            : projectionStore.findThread(threadId).pipe(
                Effect.map((thread) => (thread?.deletedAt === null ? suggestion : null)),
                Effect.orElseSucceed(() => null),
              ),
        ),
        Stream.changes,
      ),
  });
});

export const layer = Layer.effect(PromptSuggestionHub, make);
