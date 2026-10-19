import { createFileRoute, redirect } from "@tanstack/react-router";

import { CodexMicroSettings } from "../components/settings/codexMicro/CodexMicroSettings";
import { isSettingsSectionAvailable } from "../components/settings/settingsSearch";

function SettingsCodexMicroRoute() {
  return <CodexMicroSettings />;
}

export const Route = createFileRoute("/settings/codex-micro")({
  beforeLoad: () => {
    if (!isSettingsSectionAvailable("/settings/codex-micro")) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsCodexMicroRoute,
});
