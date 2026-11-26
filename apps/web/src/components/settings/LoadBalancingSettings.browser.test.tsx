import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts";
import { expect, it } from "vite-plus/test";

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
} from "~/hooks/useSettings";
import { I18nProvider } from "~/i18n/I18nProvider";
import { startI18n, whenLocaleReady } from "~/i18n/runtime";
import type { EnvironmentPresentation } from "~/state/environments";
import { render } from "../../../test/render";
import { LoadBalancingSettings } from "./LoadBalancingSettings";

it("summarizes each machine's preference in the UI language", async () => {
  using _settings = { [Symbol.dispose]: __resetClientSettingsPersistenceForTests };
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    language: "de",
    loadBalancingEnabled: true,
    loadBalancingWeights: { laptop: 100, remote: 25, spare: 0 },
  });
  startI18n();
  await whenLocaleReady();
  const environments = [
    { environmentId: "laptop", label: "Laptop" },
    { environmentId: "remote", label: "Remote" },
    { environmentId: "spare", label: "Spare" },
  ] as unknown as ReadonlyArray<EnvironmentPresentation>;

  await using screen = await render(
    <I18nProvider>
      <LoadBalancingSettings environments={environments} />
    </I18nProvider>,
  );

  await expect
    .element(screen.getByText("Laptop bevorzugen · Remote seltener · Spare nur manuell"))
    .toBeVisible();
});
