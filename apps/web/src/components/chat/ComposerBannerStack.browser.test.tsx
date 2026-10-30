import { act, render as renderUi, type Screen } from "../../../test/render";
import "../../index.css";

import { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { RunId } from "@supaterm/contracts";

import { ComposerBannerStack } from "./ComposerBannerStack";
import { usageLimitRecoveryBannerItem } from "./UsageLimitRecoveryBanner";

let fixtureScreen: Screen;
let container: HTMLDivElement;

it.each([true, false])(
  "keeps connection and usage-limit warnings visible with activity=%s",
  async (withActivity) => {
    await using _fixture = await setup();

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
    await act(async () => fixtureScreen.rerender(<ComposerBannerStack items={items} />));

    const connection = page.getByText("Host is reconnecting", { exact: true });
    const limit = page.getByText("Usage limit reached", { exact: true });
    const update = page.getByText("Server update available", { exact: true });
    await expect.element(connection).toBeVisible();
    await expect.element(limit).toBeVisible();
    await expect.element(update).not.toBeVisible();
    if (withActivity) await expect.element(page.getByText("Tasks", { exact: true })).toBeVisible();

    await act(async () =>
      page.getByRole("button", { name: "Show other notices" }).element().focus(),
    );
    await userEvent.keyboard("{Enter}");
    await expect.element(update).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(update).not.toBeVisible();
    await expect.element(connection).toBeVisible();
    await expect.element(limit).toBeVisible();

    await act(async () =>
      fixtureScreen.rerender(
        <ComposerBannerStack items={items.filter((item) => item.id !== "update")} />,
      ),
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
    await act(async () => fixtureScreen.rerender(<ComposerBannerStack items={items} />));
  }
  const update = (items: Items) =>
    act(async () => fixtureScreen.rerender(<ComposerBannerStack items={items} />));

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
    await using _fixture = await setup();

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
    await using _fixture = await setup();

    await mountStack([a, b]);
    await update([b]);
    expect(banners()).toEqual([
      ["b", "shown"],
      ["a", "exiting"],
    ]);

    await act(async () => finishExits());
    expect(banners()).toEqual([["b", "entering"]]);
  });

  it("leaves with the content a notice last showed", async () => {
    await using _fixture = await setup();

    await mountStack([{ ...a, title: "Opening" }]);
    await update([{ ...a, title: "Transcribing" }]);
    await update([]);
    expect(banners()).toEqual([["Transcribing", "exiting"]]);
  });

  it("swaps the activity row without motion", async () => {
    await using _fixture = await setup();

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
    await using _fixture = await setup();

    const onDismiss = vi.fn();
    await mountStack([{ ...notice("notice"), onDismiss }]);
    const dismiss = () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss warning"]')!;

    await act(async () => dismiss().click());
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(dismiss().closest("[inert]")).not.toBeNull();

    await act(async () => finishExits());
    expect(container.childElementCount).toBe(0);
  });
});

async function setup() {
  container = document.createElement("div");
  document.body.append(container);
  fixtureScreen = await renderUi(null, { container });

  const ownedScreen = fixtureScreen;
  return {
    async [Symbol.asyncDispose]() {
      await ownedScreen[Symbol.asyncDispose]();

      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}
