import type {
  CodexMicroAction,
  CodexMicroAgentKey,
  CodexMicroDeviceState,
  CodexMicroInputEvent,
  CodexMicroSlotStatus,
  CodexMicroThreadRef,
} from "@supaterm/contracts";
import { useState, useSyncExternalStore } from "react";

import { getCodexMicroBridge } from "./codexMicroBridge";

export interface CodexMicroSlotView {
  readonly key: CodexMicroAgentKey;
  readonly thread: CodexMicroThreadRef | null;
  readonly title: string | null;
  readonly status: CodexMicroSlotStatus;
  readonly selected: boolean;
  /** Set when a custom assignment gives this agent key an action instead of a thread. */
  readonly action: CodexMicroAction | null;
}

export interface CodexMicroPressedInput {
  readonly event: CodexMicroInputEvent;
  readonly at: number;
}

let slotViews: ReadonlyArray<CodexMicroSlotView> = [];
let pressedInput: CodexMicroPressedInput | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishCodexMicroSlots(next: ReadonlyArray<CodexMicroSlotView>): void {
  slotViews = next;
  emit();
}

export function publishCodexMicroInput(event: CodexMicroInputEvent): void {
  pressedInput = { event, at: Date.now() };
  emit();
}

/** The six agent-key bindings the coordinator last sent to the keyboard; empty while it is off. */
export function useCodexMicroSlots(): ReadonlyArray<CodexMicroSlotView> {
  return useSyncExternalStore(subscribe, () => slotViews);
}

/** The latest keyboard input, for momentary press feedback. */
export function useCodexMicroPressedInput(): CodexMicroPressedInput | null {
  return useSyncExternalStore(subscribe, () => pressedInput);
}

export function useCodexMicroDeviceState(): CodexMicroDeviceState | null {
  const [store] = useState(() => {
    let state: CodexMicroDeviceState | null = null;
    return {
      getSnapshot: () => state,
      subscribe: (notify: () => void) => {
        const bridge = getCodexMicroBridge();
        if (bridge === null) return () => {};
        let current = true;
        let pushed = false;
        const unsubscribe = bridge.onStateChange((next) => {
          pushed = true;
          if (!current) return;
          state = next;
          notify();
        });
        void bridge.getState().then(
          (next) => {
            if (!current || pushed) return;
            state = next;
            notify();
          },
          () => undefined,
        );
        return () => {
          current = false;
          unsubscribe();
        };
      },
    };
  });
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
