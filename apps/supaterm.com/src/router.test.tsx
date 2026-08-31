// @vitest-environment jsdom

import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { docsHref, githubHref } from "@/components/layout";
import { routeTree } from "./router";

const { capture } = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  posthog: {
    capture,
  },
}));

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
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("router", () => {
  it("shows the temporary coming soon page", async () => {
    await renderRoute("/");

    expect(screen.getByRole("heading", { name: "Coming soon." })).toBeTruthy();
    expect(screen.getByText("Site refresh in progress")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /buy/i })).toBeNull();
  });

  it("renders the transparent brand mark before the site title", async () => {
    await renderRoute("/");

    const brandLink = screen.getByRole("link", { name: "Supaterm" });
    const brandMark = brandLink.querySelector("img");

    expect(brandMark?.getAttribute("src")).toBe("/logo-mark.svg");
    expect(brandMark?.getAttribute("alt")).toBe("");
  });

  it("links to GitHub and the documentation site", async () => {
    await renderRoute("/");

    const docsLink = screen.getByRole("link", { name: "Docs" });
    const githubLink = screen.getByRole("link", { name: "GitHub" });

    expect(docsLink.getAttribute("href")).toBe(docsHref);
    expect(githubLink.getAttribute("href")).toBe(githubHref);

    docsLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(docsLink);
    expect(capture).toHaveBeenCalledWith("coming_soon_docs_clicked");

    githubLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(githubLink);
    expect(capture).toHaveBeenCalledWith("coming_soon_github_clicked");
  });

  it("links to the legal policies", async () => {
    await renderRoute("/");

    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: "Refunds" }).getAttribute("href")).toBe("/refunds");
  });

  it.each([
    ["/terms", "Terms of service"],
    ["/privacy", "Privacy policy"],
    ["/refunds", "Refund and cancellation policy"],
  ])("renders %s", async (path, heading) => {
    await renderRoute(path);

    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(
      screen.getAllByText(/Supaterm Limited|seven days|personal data/i).length,
    ).toBeGreaterThan(0);
  });

  it("renders the changelog page for direct navigation", async () => {
    const { history, router } = await renderRoute("/changelog");

    expect(await screen.findByRole("heading", { name: "Changelog" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "🎛️ Agent Panel" })).toBeTruthy();
    expect(document.querySelector("video")?.getAttribute("src")).toBe(
      "/changelog/agent-session-polish.mp4",
    );
    expect(screen.queryByRole("heading", { name: /The terminal with/i })).toBeNull();
    expect(history.location.pathname).toBe("/changelog");
    expect(router.state.location.pathname).toBe("/changelog");
  });
});
