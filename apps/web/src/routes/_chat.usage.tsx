import { createFileRoute, redirect } from "@tanstack/react-router";

import { AppRouteModal } from "../components/AppRouteModal";

import { UsagePage } from "../components/usage/UsagePage";

export const Route = createFileRoute("/_chat/usage")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: () => (
    <AppRouteModal label="Usage">
      <UsagePage />
    </AppRouteModal>
  ),
});
