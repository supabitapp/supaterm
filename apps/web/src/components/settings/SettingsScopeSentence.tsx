import { useLocation } from "@tanstack/react-router";

import { useEnvironments } from "../../state/environments";
import { ScopeSentence } from "./ScopeSentence";
import { useOptionalSettingsScope } from "./SettingsScopeContext";

export const SETTINGS_DEVICE_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/settings/appearance",
  "/settings/snap-shot",
  "/settings/codex-micro",
  "/settings/connections",
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
