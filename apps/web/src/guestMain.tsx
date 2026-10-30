import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/jetbrains-mono/400-italic.css";
import "@fontsource/jetbrains-mono/700-italic.css";
import "./index.css";

import { GuestPage } from "./components/guest/GuestPage";
import { APP_DISPLAY_NAME } from "./branding";

document.title = APP_DISPLAY_NAME;

export const startup = Promise.resolve().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <GuestPage />
    </React.StrictMode>,
  );
});
