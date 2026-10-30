import type { ThreadId } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";

export interface PreviewAgentTurnChange {
  readonly threadId: ThreadId;
  readonly active: boolean;
}

export class PreviewAgentActivity extends Context.Service<
  PreviewAgentActivity,
  {
    readonly begin: (threadId: ThreadId) => Effect.Effect<Effect.Effect<void>>;
    readonly active: (threadId: ThreadId) => Effect.Effect<boolean>;
    readonly changes: Effect.Effect<
      PubSub.Subscription<PreviewAgentTurnChange>,
      never,
      Scope.Scope
    >;
  }
>()("supaterm/preview/PreviewAgentActivity") {}

const make = Effect.gen(function* () {
  const changes = yield* PubSub.unbounded<PreviewAgentTurnChange>();
  const turns = new Map<ThreadId, Set<symbol>>();

  const begin = Effect.fn("PreviewAgentActivity.begin")(function* (threadId: ThreadId) {
    const existing = turns.get(threadId);
    const tokens = existing ?? new Set<symbol>();
    if (existing === undefined) turns.set(threadId, tokens);
    const token = Symbol(threadId);
    tokens.add(token);
    if (existing === undefined) yield* PubSub.publish(changes, { threadId, active: true });
    return Effect.suspend(() => {
      if (!tokens.delete(token) || tokens.size > 0) return Effect.void;
      if (turns.get(threadId) === tokens) turns.delete(threadId);
      return PubSub.publish(changes, { threadId, active: false }).pipe(Effect.asVoid);
    });
  });

  return PreviewAgentActivity.of({
    begin,
    active: Effect.fn("PreviewAgentActivity.active")(function (threadId) {
      return Effect.sync(() => turns.has(threadId));
    }),
    changes: PubSub.subscribe(changes),
  });
});

export const layer = Layer.effect(PreviewAgentActivity, make);
