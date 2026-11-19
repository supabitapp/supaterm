import { useSyncExternalStore } from "react";

import { resolveBrowserLayoutZoomFactor } from "./browserViewportLayout";

const subscribeToWindowZoom = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};
const readWindowZoomFactor = () => window.desktopBridge?.getWindowZoomFactor() ?? 1;

export function useBrowserLayoutZoomFactor(previewZoomFactor: number) {
  const windowZoomFactor = useSyncExternalStore(subscribeToWindowZoom, readWindowZoomFactor);
  return resolveBrowserLayoutZoomFactor(previewZoomFactor, windowZoomFactor);
}
