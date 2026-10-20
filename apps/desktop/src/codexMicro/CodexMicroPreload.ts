import type {
  CodexMicroDeviceState,
  CodexMicroInputEvent,
  DesktopCodexMicroBridge,
} from "@supaterm/contracts";
import { ipcRenderer } from "electron";

import * as IpcChannels from "./CodexMicroChannels.ts";

const PENDING_FOCUS_MS = 10_000;

function isFocusEvent(value: unknown): value is CodexMicroInputEvent {
  if (typeof value !== "object" || value === null) return false;
  const { type, focus } = value as { type?: unknown; focus?: unknown };
  return type === "agent-key" && focus === true;
}

/** Undefined in a desktop build packaged without Codex Micro, so the client hides it. */
export function makeCodexMicroBridge(): DesktopCodexMicroBridge | undefined {
  if (ipcRenderer.sendSync(IpcChannels.CODEX_MICRO_AVAILABLE_CHANNEL) !== true) return undefined;

  // A focus press can recreate the main window, so it is held until the keyboard
  // coordinator subscribes instead of being lost while the app loads.
  let pendingFocus: { readonly event: CodexMicroInputEvent; readonly at: number } | null = null;
  let inputListeners = 0;
  ipcRenderer.on(IpcChannels.CODEX_MICRO_INPUT_CHANNEL, (_event, inputEvent: unknown) => {
    if (inputListeners > 0 || !isFocusEvent(inputEvent)) return;
    pendingFocus = { event: inputEvent, at: performance.now() };
  });
  const takePendingFocus = () => {
    const pending = pendingFocus;
    pendingFocus = null;
    if (pending === null || performance.now() - pending.at > PENDING_FOCUS_MS) return null;
    return pending.event;
  };

  return {
    getState: () => ipcRenderer.invoke(IpcChannels.CODEX_MICRO_GET_STATE_CHANNEL),
    onStateChange: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as CodexMicroDeviceState);
      };
      ipcRenderer.on(IpcChannels.CODEX_MICRO_STATE_CHANNEL, wrappedListener);
      return () =>
        ipcRenderer.removeListener(IpcChannels.CODEX_MICRO_STATE_CHANNEL, wrappedListener);
    },
    onInput: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, inputEvent: unknown) => {
        if (typeof inputEvent !== "object" || inputEvent === null) return;
        listener(inputEvent as CodexMicroInputEvent);
      };
      ipcRenderer.on(IpcChannels.CODEX_MICRO_INPUT_CHANNEL, wrappedListener);
      inputListeners += 1;
      const pending = takePendingFocus();
      if (pending !== null) queueMicrotask(() => listener(pending));
      return () => {
        inputListeners -= 1;
        ipcRenderer.removeListener(IpcChannels.CODEX_MICRO_INPUT_CHANNEL, wrappedListener);
      };
    },
    setLighting: (model) => ipcRenderer.invoke(IpcChannels.CODEX_MICRO_SET_LIGHTING_CHANNEL, model),
  };
}
