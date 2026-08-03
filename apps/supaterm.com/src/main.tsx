import { RouterProvider } from "@tanstack/react-router";
import { posthog } from "posthog-js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { router } from "./router";

posthog.init("phc_AwJsG6OgXpxwREkX5OW41cZ1tjjoLplTif5KbocleFx", {
  api_host: "https://p.supaterm.com",
  ui_host: "https://us.posthog.com",
  defaults: "2026-01-30",
  person_profiles: "identified_only",
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
