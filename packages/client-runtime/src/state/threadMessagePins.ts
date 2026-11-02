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

interface PendingMessagePin {
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly pinned: boolean;
  sequence?: number;
}

interface MessagePinTarget {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly threadId: ThreadId; readonly itemId: TurnItemId };
}

function withPendingPins(
  state: EnvironmentThreadState,
  pending: ReadonlyArray<PendingMessagePin>,
): EnvironmentThreadState {
  if (Option.isNone(state.data)) return state;
  const projection = state.data.value;
  const current = projection.thread.pinnedMessages ?? [];
  let pins: ReadonlyArray<ThreadPinnedMessage> = current;
  for (const update of pending) {
    if (update.sequence !== undefined && update.sequence <= state.sequence) continue;
    const isPinned = pins.some((pin) => pin.itemId === update.itemId);
    if (!update.pinned) {
      if (isPinned) pins = pins.filter((pin) => pin.itemId !== update.itemId);
      continue;
    }
    if (isPinned) continue;
    const visible = projection.visibleTurnItems.find((row) => row.sourceItemId === update.itemId);
    if (visible === undefined || !isPinnableMessageItem(visible.item)) continue;
    pins = withPinnedMessage(pins, pinnedMessageOf(visible.item, visible.sourceThreadId));
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
  const pendingAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<ReadonlyArray<PendingMessagePin>>([]).pipe(Atom.keepAlive),
  );
  const stateFamily = Atom.family((key: string) => {
    const { environmentId, threadId } = parseThreadKey(key);
    return Atom.make((get) => {
      const result = get(sourceStateAtom(environmentId, threadId));
      const pending = get(pendingAtom(environmentId)).filter(
        (update) => update.threadId === threadId,
      );
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
        const pending = pendingAtom(target.environmentId);
        const source = sourceStateAtom(target.environmentId, target.input.threadId);
        const update: PendingMessagePin = {
          threadId: target.input.threadId,
          itemId: target.input.itemId,
          pinned,
        };
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
