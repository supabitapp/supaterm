import type { DesktopSidePulseBridge, SidePulseDeviceState } from "@supaterm/contracts";
import { ipcRenderer } from "electron";

import * as IpcChannels from "./SidePulseChannels.ts";

/** SidePulse mounts as a removable volume, which Supaterm only looks for on macOS and Linux. */
export function makeSidePulseBridge(platform: NodeJS.Platform): DesktopSidePulseBridge | undefined {
  if (platform !== "darwin" && platform !== "linux") return undefined;
  return {
    getState: () => ipcRenderer.invoke(IpcChannels.SIDE_PULSE_GET_STATE_CHANNEL),
    onStateChange: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as SidePulseDeviceState);
      };
      ipcRenderer.on(IpcChannels.SIDE_PULSE_STATE_CHANNEL, wrappedListener);
      return () =>
        ipcRenderer.removeListener(IpcChannels.SIDE_PULSE_STATE_CHANNEL, wrappedListener);
    },
    setLedState: (state) => ipcRenderer.invoke(IpcChannels.SIDE_PULSE_SET_LED_STATE_CHANNEL, state),
  };
}
