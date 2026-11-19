import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: () => null,
});
