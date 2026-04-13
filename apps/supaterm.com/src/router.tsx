import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "@/components/layout";
import { HomePage } from "@/routes/home";
import { ChangelogPage } from "@/routes/changelog";

const rootRoute = createRootRoute({
  component: Layout,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const changelogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/changelog",
  component: ChangelogPage,
});

const routeTree = rootRoute.addChildren([homeRoute, changelogRoute]);

const router = createRouter({
  routeTree,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export { router };
