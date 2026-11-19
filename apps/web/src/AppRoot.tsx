import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { DesktopUpdateRestartScreen } from "./components/desktop/DesktopUpdateRestartScreen";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import { ThreadOutboxCoordinator } from "./components/ThreadOutboxCoordinator";

export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      <ThreadOutboxCoordinator />
      <ElectronBrowserHost />
      <DesktopUpdateRestartScreen />
    </AppAtomRegistryProvider>
  );
}
