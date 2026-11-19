import type {
  CodexMicroAction,
  CodexMicroAgentKey,
  CodexMicroInputEvent,
  CodexMicroSlotStatus,
  CodexMicroThreadRef,
} from "@supaterm/contracts";
import { useSyncExternalStore } from "react";

import { useDesktopDeviceState } from "../../hooks/useDesktopDeviceState";
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

export function publishCodexMicroSlots(next: ReadonlyArray<CodexMicroSlotView>) {
  slotViews = next;
  emit();
}

export function publishCodexMicroInput(event: CodexMicroInputEvent) {
  pressedInput = { event, at: Date.now() };
  emit();
}

/** The six agent-key bindings the coordinator last sent to the keyboard; empty while it is off. */
export function useCodexMicroSlots() {
  return useSyncExternalStore(subscribe, () => slotViews);
}

/** The latest keyboard input, for momentary press feedback. */
export function useCodexMicroPressedInput() {
  return useSyncExternalStore(subscribe, () => pressedInput);
}

export function useCodexMicroDeviceState() {
  return useDesktopDeviceState(getCodexMicroBridge());
}
