import { posthog } from "posthog-js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

posthog.init("phc_AwJsG6OgXpxwREkX5OW41cZ1tjjoLplTif5KbocleFx", {
  api_host: "https://us.i.posthog.com",
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
