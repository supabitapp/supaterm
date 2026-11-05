import { createFileRoute, redirect } from "@tanstack/react-router";

import { SidePulseSettings } from "../components/sidePulse/settings/SidePulseSettings";
import { isSettingsSectionAvailable } from "../components/settings/settingsSearch";

export const Route = createFileRoute("/_chat/settings/sidepulse")({
  beforeLoad: () => {
    if (!isSettingsSectionAvailable("/settings/sidepulse")) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SidePulseSettings,
});
