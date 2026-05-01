// @vitest-environment jsdom

import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { downloadHref } from "@/lib/downloads";
import { routeTree } from "./router";

const { capture } = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  posthog: {
    capture,
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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("router", () => {
  it("clicking download keeps the SPA on the current page", async () => {
    const { history, router } = await renderRoute("/");

    const downloadLinks = screen.getAllByRole("link", {
      name: /^download/i,
    });

    expect(downloadLinks.length).toBeGreaterThan(0);

    for (const link of downloadLinks) {
      expect(link.getAttribute("href")).toBe(downloadHref);
      expect(link.hasAttribute("download")).toBe(true);
    }

    const downloadLink = screen.getByRole("link", {
      name: /^download$/i,
    });

    let defaultPrevented = false;
    const preventDocumentNavigation = (event: MouseEvent) => {
      if (event.target !== downloadLink) {
        return;
      }

      defaultPrevented = event.defaultPrevented;
      event.preventDefault();
    };

    document.addEventListener("click", preventDocumentNavigation);
    fireEvent.click(downloadLink);
    document.removeEventListener("click", preventDocumentNavigation);

    await waitFor(() => {
      expect(history.location.pathname).toBe("/");
      expect(router.state.location.pathname).toBe("/");
    });

    expect(defaultPrevented).toBe(false);
    expect(screen.getByRole("heading", { name: /The terminal with/i })).toBeTruthy();
    expect(capture).toHaveBeenCalledWith("nav_download_clicked");
  });

  it("renders the transparent brand mark before the site title", async () => {
    await renderRoute("/");

    const brandLink = screen.getByRole("link", { name: "Supaterm" });
    const brandMark = brandLink.querySelector("img");

    expect(brandMark?.getAttribute("src")).toBe("/logo-mark.svg");
    expect(brandMark?.getAttribute("alt")).toBe("");
  });

  it("renders the changelog page for direct navigation", async () => {
    const { history, router } = await renderRoute("/changelog");

    expect(await screen.findByRole("heading", { name: "Changelog" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /The terminal with/i })).toBeNull();
    expect(history.location.pathname).toBe("/changelog");
    expect(router.state.location.pathname).toBe("/changelog");
  });
});
