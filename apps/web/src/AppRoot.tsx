import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { DesktopUpdateRestartScreen } from "./components/desktop/DesktopUpdateRestartScreen";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import { ThreadOutboxCoordinator } from "./components/ThreadOutboxCoordinator";

// Keep webviews outside the router but inside its atom registry so route changes preserve them.
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      <ThreadOutboxCoordinator />
      <ElectronBrowserHost />
      <QuitHoldOverlay />
      <DesktopUpdateRestartScreen />
    </AppAtomRegistryProvider>
  );
}
