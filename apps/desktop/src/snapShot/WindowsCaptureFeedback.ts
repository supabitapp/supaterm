import * as Electron from "electron";

const WINDOW_ANIMATIONS_DISABLED = "wm-window-animations-disabled";

export function showWindowsCaptureOverlay(window: Electron.BaseWindow): void {
  const alreadyDisabled = Electron.app.commandLine.hasSwitch(WINDOW_ANIMATIONS_DISABLED);
  if (!alreadyDisabled) Electron.app.commandLine.appendSwitch(WINDOW_ANIMATIONS_DISABLED);
  try {
    window.showInactive();
  } finally {
    if (!alreadyDisabled) Electron.app.commandLine.removeSwitch(WINDOW_ANIMATIONS_DISABLED);
  }
}
