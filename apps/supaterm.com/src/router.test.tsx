// @vitest-environment jsdom

import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { downloadHref } from "@/lib/downloads";
import { routeTree } from "./router";

vi.mock("posthog-js", () => ({
  posthog: {
    capture: vi.fn(),
  },
}));

class MockIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];

  disconnect() {}

  observe() {}

  takeRecords() {
    return [];
  }

  unobserve() {}
}

const renderRoute = async (initialPath: string) => {
  const history = createMemoryHistory({
    initialEntries: [initialPath],
  });
  const router = createRouter({
    routeTree,
    history,
    scrollRestoration: false,
  });

  render(<RouterProvider router={router} />);
  await router.load();

  return { history, router };
};

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("router", () => {
  it("renders download links that point to the latest dmg route", async () => {
    await renderRoute("/");

    const downloadLinks = screen.getAllByRole("link", {
      name: /^download/i,
    });

    expect(downloadLinks.length).toBeGreaterThan(0);

    for (const link of downloadLinks) {
      expect(link.getAttribute("href")).toBe(downloadHref);
      expect(link.hasAttribute("download")).toBe(true);
    }
  });

  it("renders the changelog page for direct navigation", async () => {
    const { history, router } = await renderRoute("/changelog");

    expect(await screen.findByRole("heading", { name: "Changelog" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /The terminal with/i })).toBeNull();
    expect(history.location.pathname).toBe("/changelog");
    expect(router.state.location.pathname).toBe("/changelog");
  });
});
