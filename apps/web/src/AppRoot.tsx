import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { DesktopUpdateRestartScreen } from "./components/desktop/DesktopUpdateRestartScreen";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import { ThreadOutboxCoordinator } from "./components/ThreadOutboxCoordinator";

/**
 * The Electron browser host intentionally sits outside the router so its
 * webviews survive route transitions, but it must share the same atom registry
 * as routed UI.
 */
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
