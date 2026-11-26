import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts";
import { createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../test/render";
import { AppRoot } from "./AppRoot";
import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
} from "./hooks/useSettings";
import { startI18n, whenLocaleReady } from "./i18n/runtime";
import type { AppRouter } from "./router";
import { desktopUpdateRestart } from "./state/desktopUpdateRestart";

vi.mock(import("./browser/ElectronBrowserHost"), () => ({ ElectronBrowserHost: () => null }));
vi.mock(import("./components/ThreadOutboxCoordinator"), () => ({
  ThreadOutboxCoordinator: () => null,
}));

function LanguageRoute() {
  const gt = useGT();
  return <span>{gt("Language")}</span>;
}

it("shows the update restart screen in the UI language", async () => {
  using _state = {
    [Symbol.dispose]: () => {
      __resetClientSettingsPersistenceForTests();
      desktopUpdateRestart.store.setState({ isRestarting: false });
    },
  };
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, language: "de" });
  startI18n();
  await whenLocaleReady();
  desktopUpdateRestart.store.setState({ isRestarting: true });
  const router = createRouter({
    routeTree: createRootRoute({ component: LanguageRoute }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  }) as unknown as AppRouter;

  // AppRoot mounts its own router.
  await using screen = await render(<AppRoot router={router} />, { router: false });

  await expect.element(screen.getByText("Sprache")).toBeInTheDocument();
  await expect
    .element(page.getByRole("dialog", { name: "Supaterm wird neu gestartet…" }))
    .toHaveAccessibleDescription(
      "Das Update wird installiert. Die App wird automatisch wieder geöffnet.",
    );
});
