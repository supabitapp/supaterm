import { AuthPreviewOperateScope, type BrowserProfile } from "@supaterm/contracts";
import { useEffect } from "react";

import { useClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";
import { useServerConfigs } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentsWithScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

const selectProfiles = (settings: { readonly browserProfiles: ReadonlyArray<BrowserProfile> }) =>
  settings.browserProfiles;
const selectDefaultProfileId = (settings: { readonly browserDefaultProfileId: string }) =>
  settings.browserDefaultProfileId;

export function BrowserProfileReporter() {
  const hydrated = useClientSettingsHydrated();
  const profiles = useClientSettings(selectProfiles);
  const defaultProfileId = useClientSettings(selectDefaultProfileId);
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const operable = useEnvironmentsWithScope(environments, AuthPreviewOperateScope);
  const report = useAtomCommand(previewEnvironment.reportProfiles, { reportFailure: false });

  useEffect(() => {
    if (!hydrated) return;
    for (const environmentId of serverConfigs.keys()) {
      if (!operable.has(environmentId)) continue;
      void report({ environmentId, input: { profiles, defaultProfileId } });
    }
  }, [defaultProfileId, hydrated, operable, profiles, report, serverConfigs]);

  return null;
}
