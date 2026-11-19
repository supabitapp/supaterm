import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: () => null,
});
