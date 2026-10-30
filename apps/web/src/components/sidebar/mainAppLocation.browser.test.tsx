import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, it } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SidebarBackToApp } from "./SidebarChrome";
import { MainAppLocationTracker, useNavigateToMainApp } from "./mainAppLocation";

function Navigation() {
  const main = useNavigateToMainApp();
  return (
    <SidebarProvider>
      <MainAppLocationTracker />
      <SidebarBackToApp />
      <button onClick={() => void main()}>Return to thread</button>
    </SidebarProvider>
  );
}

it("returns settings to the opening utility page without replacing the thread return target", async () => {
  const root = createRootRoute({ component: Navigation });
  const paths = ["/", "/pull-requests", "/settings", "/settings/about", "/usage"] as const;
  const router = createRouter({
    routeTree: root.addChildren(
      paths.map((path) => createRoute({ getParentRoute: () => root, path })),
    ),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await using screen = await render(<RouterProvider router={router} />, { router: false });
  await act(() => router.navigate({ href: "/pull-requests?state=open" }));
  await act(() => router.navigate({ to: "/settings" }));
  await act(() => router.navigate({ to: "/settings/about" }));

  await screen.getByRole("button", { name: "Back to app" }).click();
  expect(router.state.location.href).toBe("/pull-requests?state=open");

  await act(() => router.navigate({ to: "/usage" }));
  await screen.getByRole("button", { name: "Back to app" }).click();
  expect(router.state.location.href).toBe("/pull-requests?state=open");

  await screen.getByRole("button", { name: "Return to thread" }).click();
  expect(router.state.location.href).toBe("/");
});
