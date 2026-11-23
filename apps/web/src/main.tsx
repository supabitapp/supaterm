import React from "react";
import ReactDOM from "react-dom/client";

import "allo-font/allo-friendly.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/jetbrains-mono/400-italic.css";
import "@fontsource/jetbrains-mono/700-italic.css";
import "./index.css";

import { trackKeyboardLayout } from "./keyboardLayout";
import { startAppServices } from "./appInit";
import { AppRoot } from "./AppRoot";
import { chunkLoadState } from "./lib/chunkReloadGuard";

const stopTrackingKeyboardLayout = trackKeyboardLayout();
import.meta.hot?.dispose(stopTrackingKeyboardLayout);

const router = startAppServices();

// The index.html boot splash lives inside #root, and React's first commit
// clears it. Resolve the initial route's split chunks before rendering, so the
// splash holds until real UI paints instead of dropping to a blank window while
// chunks download.
export const startup = router
  .load()
  .then(() => {
    // A route chunk failure still resolves router.load(): the error is parked in
    // the lazy component and surfaces through the route error boundary.
    if (chunkLoadState.reloadScheduled) return;
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <AppRoot router={router} />
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    if (chunkLoadState.reloadScheduled) return;
    throw error;
  });
