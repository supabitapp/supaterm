import { useLocation } from "@tanstack/react-router";

import { useEnvironments } from "../../state/environments";
import { ScopeSentence } from "./ScopeSentence";
import { useOptionalSettingsScope } from "./SettingsScopeContext";

export const SETTINGS_DEVICE_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/settings/general",
  "/settings/appearance",
  "/settings/chat",
  "/settings/diffs",
  "/settings/snap-shot",
  "/settings/codex-micro",
  "/settings/sidepulse",
  "/settings/connections",
  // Access picks its environment on the page itself.
  "/settings/access",
  "/settings/about",
]);

export function SettingsScopeSentence() {
  const scope = useOptionalSettingsScope();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { environments } = useEnvironments();
  if (scope === null || SETTINGS_DEVICE_ONLY_PATHS.has(pathname)) return null;
  return (
    <ScopeSentence
      lead="Applying settings for"
      value={scope.search}
      scope={scope.scope}
      singleEnvironment={scope.singleEnvironment}
      groups={scope.groups}
      environments={environments}
      onChange={scope.selectScope}
    />
  );
}
