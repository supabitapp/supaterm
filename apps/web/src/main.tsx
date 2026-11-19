import React from "react";
import ReactDOM from "react-dom/client";

import "allo-font/allo-friendly.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/jetbrains-mono/400-italic.css";
import "@fontsource/jetbrains-mono/700-italic.css";
import "./index.css";

import { startAppServices } from "./appInit";
import { AppRoot } from "./AppRoot";
import { reloadOnceForChunkLoadError } from "./lib/chunkReloadGuard";

const router = startAppServices();

let reloadScheduled = false;
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnceForChunkLoadError()) {
    reloadScheduled = true;
    event.preventDefault();
  }
});

export const startup = router
  .load()
  .then(() => {
    if (reloadScheduled) return;
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <AppRoot router={router} />
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    if (reloadScheduled) return;
    throw error;
  });
