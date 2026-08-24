import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "@/components/layout";
import { HomePage } from "@/routes/home";
import { ChangelogPage } from "@/routes/changelog";
import { PrivacyPage, RefundsPage, TermsPage } from "@/routes/legal";

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

const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/terms",
  component: TermsPage,
});

const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/privacy",
  component: PrivacyPage,
});

const refundsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/refunds",
  component: RefundsPage,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  changelogRoute,
  termsRoute,
  privacyRoute,
  refundsRoute,
]);

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
export { routeTree };
