import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
} from "~/hooks/useSettings";
import { I18nProvider } from "~/i18n/I18nProvider";
import { startI18n, whenLocaleReady } from "~/i18n/runtime";
import { render } from "../../../test/render";
import { useHostedPromptLinkLanding } from "./HostedPromptLinkLanding";

vi.mock(import("~/hostedPairing"), async (original) => ({
  ...(await original()),
  isHostedStaticApp: () => true,
}));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: [], isReady: true })) as never,
}));

function Landing() {
  return useHostedPromptLinkLanding(true);
}

it("describes a prompt link in the UI language", async () => {
  using _settings = { [Symbol.dispose]: __resetClientSettingsPersistenceForTests };
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, language: "de" });
  startI18n();
  await whenLocaleReady();

  await using screen = await render(
    <I18nProvider>
      <Landing />
    </I18nProvider>,
    { router: "/new?prompt=Fix%20the%20build&repo=owner/repo&provider=codex" },
  );

  await expect.element(screen.getByRole("heading", { name: "Diesen Prompt öffnen" })).toBeVisible();
  await expect
    .element(
      screen.getByText("Er öffnet sich als Entwurf. Nichts läuft, bevor du auf Senden drückst."),
    )
    .toBeVisible();
  await expect.element(screen.getByText("Repository owner/repo · Modell codex")).toBeVisible();
});
