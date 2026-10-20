import "../../index.css";

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { RunId } from "@supaterm/contracts";

import { ComposerBannerStack } from "./ComposerBannerStack";
import { usageLimitRecoveryBannerItem } from "./UsageLimitRecoveryBanner";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const nextFrame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));

async function render(width: number, description: string) {
  container.style.width = `${width}px`;
  await act(async () =>
    root.render(
      <ComposerBannerStack
        items={[{ id: "usage", variant: "info", icon: null, title: "Usage limits", description }]}
      />,
    ),
  );
  await nextFrame();
}

const hasDetails = () => container.querySelector('[aria-label="Show notice details"]') !== null;

it("only offers notice details when the description cannot fit", async () => {
  await render(700, "OpenCode");
  expect(hasDetails()).toBe(false);

  await render(700, "OpenCode ".repeat(40));
  expect(hasDetails()).toBe(true);

  container.style.width = "4000px";
  await nextFrame();
  expect(hasDetails()).toBe(false);

  await render(4000, "OpenCode");
  expect(hasDetails()).toBe(false);

  // A narrow composer hides the description entirely, so details are the only way to read it.
  container.style.width = "300px";
  await nextFrame();
  expect(hasDetails()).toBe(true);
});

it.each([true, false])(
  "keeps connection and usage-limit warnings visible with activity=%s",
  async (withActivity) => {
    const items: ComponentProps<typeof ComposerBannerStack>["items"] = [
      ...(withActivity
        ? [
            {
              id: "activity",
              variant: "default" as const,
              priority: "activity" as const,
              content: "Tasks",
            },
          ]
        : []),
      {
        id: "connection",
        variant: "warning",
        alwaysVisible: true,
        icon: null,
        title: "Host is reconnecting",
      },
      usageLimitRecoveryBannerItem({
        runId: RunId.make("limited"),
        resetAt: null,
        stoppedAt: "2026-10-20T12:00:00.000Z",
        snoozedUntil: null,
        recovery: null,
        onChange: async () => {},
      }),
      { id: "update", variant: "info", icon: null, title: "Server update available" },
    ];
    await act(async () => root.render(<ComposerBannerStack items={items} />));

    const connection = page.getByText("Host is reconnecting", { exact: true });
    const limit = page.getByText("Usage limit reached", { exact: true });
    const update = page.getByText("Server update available", { exact: true });
    await expect.element(connection).toBeVisible();
    await expect.element(limit).toBeVisible();
    await expect.element(update).not.toBeVisible();
    if (withActivity) await expect.element(page.getByText("Tasks", { exact: true })).toBeVisible();

    await act(async () =>
      userEvent.click(page.getByRole("button", { name: "Show other notices" })),
    );
    await expect.element(update).toBeVisible();
    await act(async () => userEvent.keyboard("{Escape}"));
    await expect.element(update).not.toBeVisible();
    await expect.element(connection).toBeVisible();
    await expect.element(limit).toBeVisible();

    await act(async () =>
      root.render(<ComposerBannerStack items={items.filter((item) => item.id !== "update")} />),
    );
    await expect
      .element(page.getByRole("button", { name: "Show other notices" }))
      .not.toBeInTheDocument();
    await expect.element(connection).toBeVisible();
    await expect.element(limit).toBeVisible();
  },
);

describe("notice exits", () => {
  type Items = ComponentProps<typeof ComposerBannerStack>["items"];
  const notice = (id: string) => ({ id, variant: "info" as const, icon: null, title: id });
  const a = notice("a");
  const b = notice("b");
  const c = notice("c");
  let finishExits = () => {};

  async function mountStack(items: Items) {
    const finished = new Promise<void>((resolve) => {
      finishExits = resolve;
    });
    vi.spyOn(Element.prototype, "getAnimations").mockReturnValue([
      { effect: null, finished } as unknown as Animation,
    ]);
    await act(async () => root.render(<ComposerBannerStack items={items} />));
  }
  const update = (items: Items) =>
    act(async () => root.render(<ComposerBannerStack items={items} />));

  const banners = () =>
    [...container.querySelectorAll<HTMLElement>('div[data-slot="composer-banner"]')].map((node) => [
      node.textContent,
      node.hasAttribute("data-ending-style")
        ? "exiting"
        : node.hasAttribute("data-enter")
          ? "entering"
          : "shown",
    ]);

  it("keeps a removed notice in its place until its exit finishes", async () => {
    await mountStack([a, b, c]);
    await update([a, c]);
    expect(banners()).toEqual([
      ["b", "exiting"],
      ["c", "shown"],
      ["a", "shown"],
    ]);

    await act(async () => finishExits());
    expect(banners()).toEqual([
      ["c", "shown"],
      ["a", "shown"],
    ]);
  });

  it("raises the next notice only once the departing front has left", async () => {
    await mountStack([a, b]);
    await update([b]);
    expect(banners()).toEqual([
      ["b", "shown"],
      ["a", "exiting"],
    ]);

    await act(async () => finishExits());
    expect(banners()).toEqual([["b", "entering"]]);
  });

  it("swaps the activity row without motion", async () => {
    const activity = {
      id: "activity",
      variant: "default" as const,
      priority: "activity" as const,
      content: "activity",
    };
    await mountStack([activity, a]);
    await update([a]);
    expect(banners()).toEqual([["a", "shown"]]);
  });

  it("reports a dismissal at once and unmounts the notice after its exit", async () => {
    const onDismiss = vi.fn();
    await mountStack([{ ...notice("notice"), onDismiss }]);
    const dismiss = () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss warning"]')!;

    await act(async () => dismiss().click());
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(dismiss().disabled).toBe(true);

    await act(async () => finishExits());
    expect(container.childElementCount).toBe(0);
  });
});
