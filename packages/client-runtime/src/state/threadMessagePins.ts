import type { EnvironmentId, ThreadId, ThreadPinnedMessage, TurnItemId } from "@supaterm/contracts";
import {
  isPinnableMessageItem,
  pinnedMessageOf,
  withPinnedMessage,
} from "@supaterm/shared/pinnedMessages";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { parseThreadKey, threadKey } from "./entities.ts";
import type { AtomCommand } from "./runtime.ts";
import type { EnvironmentThreadState } from "./threadState.ts";

type PendingMessagePin = (
  | { readonly kind: "pin"; readonly pin: ThreadPinnedMessage }
  | { readonly kind: "unpin"; readonly itemId: TurnItemId }
) & { sequence?: number };

interface MessagePinTarget {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly threadId: ThreadId; readonly itemId: TurnItemId };
}

function optimisticPin(
  result: AsyncResult.AsyncResult<EnvironmentThreadState, unknown>,
  itemId: TurnItemId,
): ThreadPinnedMessage | null {
  const projection = AsyncResult.value(result).pipe(
    Option.flatMap((state) => state.data),
    Option.getOrNull,
  );
  const row = projection?.visibleTurnItems.find((visible) => visible.sourceItemId === itemId);
  return row !== undefined && isPinnableMessageItem(row.item)
    ? pinnedMessageOf(row.item, row.sourceThreadId)
    : null;
}

function withPendingPins(
  state: EnvironmentThreadState,
  pending: ReadonlyArray<PendingMessagePin>,
): EnvironmentThreadState {
  if (Option.isNone(state.data)) return state;
  const projection = state.data.value;
  const current = projection.thread.pinnedMessages ?? [];
  let pins = current;
  for (const update of pending) {
    if (update.sequence !== undefined && update.sequence <= state.sequence) continue;
    const itemId = update.kind === "pin" ? update.pin.itemId : update.itemId;
    if (pins.some((pin) => pin.itemId === itemId) === (update.kind === "pin")) continue;
    pins =
      update.kind === "pin"
        ? withPinnedMessage(pins, update.pin)
        : pins.filter((pin) => pin.itemId !== itemId);
  }
  if (pins === current) return state;
  return {
    ...state,
    data: Option.some({ ...projection, thread: { ...projection.thread, pinnedMessages: pins } }),
  };
}

export function createOptimisticMessagePins<E>(
  sourceStateAtom: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentThreadState, E>>,
) {
  const pendingAtom = Atom.family((_threadKey: string) =>
    Atom.make<ReadonlyArray<PendingMessagePin>>([]).pipe(Atom.keepAlive),
  );
  const stateFamily = Atom.family((key: string) => {
    const { environmentId, threadId } = parseThreadKey(key);
    return Atom.make((get) => {
      const result = get(sourceStateAtom(environmentId, threadId));
      const pending = get(pendingAtom(key));
      return pending.length === 0
        ? result
        : AsyncResult.map(result, (state) => withPendingPins(state, pending));
    }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`environment-thread-state-pins:${key}`));
  });

  function wrap<W extends MessagePinTarget, A extends { readonly sequence: number }, CommandError>(
    command: AtomCommand<W, A, CommandError>,
    pinned: boolean,
  ): AtomCommand<W, A, CommandError> {
    return {
      label: command.label,
      run: async (registry, target) => {
        const { environmentId, input } = target;
        const source = sourceStateAtom(environmentId, input.threadId);
        const pin = pinned ? optimisticPin(registry.get(source), input.itemId) : null;
        if (pinned && pin === null) return command.run(registry, target);
        const update: PendingMessagePin =
          pin === null ? { kind: "unpin", itemId: input.itemId } : { kind: "pin", pin };
        const pending = pendingAtom(threadKey({ environmentId, threadId: input.threadId }));
        const remove = () =>
          registry.update(pending, (current) => current.filter((item) => item !== update));
        registry.update(pending, (current) => [...current, update]);
        let confirmed = false;
        try {
          const result = await command.run(registry, target);
          if (result._tag === "Success") {
            update.sequence = result.value.sequence;
            registry.update(pending, (current) => [...current]);
            const reconcile = (value: AsyncResult.AsyncResult<EnvironmentThreadState, E>) => {
              const state = Option.getOrNull(AsyncResult.value(value));
              if (
                state === null ||
                Option.isNone(state.data) ||
                state.sequence >= result.value.sequence
              ) {
                remove();
                unsubscribe();
              }
            };
            const unsubscribe = registry.subscribe(source, reconcile);
            reconcile(registry.get(source));
            confirmed = true;
          }
          return result;
        } finally {
          if (!confirmed) remove();
        }
      },
    };
  }

  return {
    stateAtom: (environmentId: EnvironmentId, threadId: ThreadId) =>
      stateFamily(threadKey({ environmentId, threadId })),
    wrap,
  };
}
