import { act, render as renderUi, type Screen } from "../../../test/render";
import "../../index.css";

import { InfoIcon } from "@supaterm/icons";
import { type ComponentProps, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { RunId } from "@supaterm/contracts";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerBanner } from "./ComposerBanner";
import {
  ComposerBannerStack,
  NoticeText,
  type ComposerBannerStackItem,
} from "./ComposerBannerStack";
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
        timestampFormat: "locale",
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

it("commits a dismissal when the thread switches during the exit transition", async () => {
  const onDismiss = vi.fn();
  const item: ComposerBannerStackItem = {
    id: "notice",
    variant: "info",
    icon: <InfoIcon />,
    title: "Thread A notice",
    dismissLabel: "Dismiss notice",
    onDismiss,
  };
  await using screen = await renderUi(<ComposerBannerStack key="thread-a" items={[item]} />);

  await userEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
  // The composer keys the stack by thread, so switching threads remounts it mid-exit.
  await screen.rerender(<ComposerBannerStack key="thread-b" items={[]} />);

  await vi.waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
});

function noticeRow(width: string, children: ReactNode) {
  return (
    <div data-testid="row" className="flex items-center gap-1.5" style={{ width }}>
      <NoticeText detailsLabel="Show details" className="min-w-0 truncate">
        {children}
      </NoticeText>
    </div>
  );
}

it("leaves out the details button when only a link's hit area reaches past the text", async () => {
  // Phones lay out in device pixels, so a range can measure one float32 step (2^-17 px at
  // this size) wider than its element. Headless Chromium's rects agree exactly.
  const rangeRect = Range.prototype.getBoundingClientRect;
  using _rangeRect = vi
    .spyOn(Range.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Range) {
      const rect = rangeRect.call(this);
      return new DOMRect(rect.x, rect.y, rect.width + 2 ** -17, rect.height);
    });
  // The flicker is a details button that mounts and then unmounts, so record every insertion.
  const inserted: Node[] = [];
  using observing = new DisposableStack();
  const mutations = new MutationObserver((records) =>
    inserted.push(...records.flatMap((record) => [...record.addedNodes])),
  );
  mutations.observe(document.body, { childList: true, subtree: true });
  observing.defer(() => mutations.disconnect());
  await using screen = await renderUi(
    noticeRow(
      "20rem",
      <>
        Needs input{" "}
        <button type="button" className="relative after:absolute after:-inset-x-10 after:inset-y-0">
          Review
        </button>
      </>,
    ),
  );

  await expect.element(screen.getByText("Review")).toBeVisible();
  const details = [
    ...inserted,
    ...mutations.takeRecords().flatMap((record) => [...record.addedNodes]),
  ].filter(
    (node) =>
      node instanceof Element &&
      (node.matches('[aria-label="Show details"]') ||
        node.querySelector('[aria-label="Show details"]')),
  );
  expect(details).toEqual([]);
});

it("leaves out the details button while a popover opened from the notice text is open", async () => {
  await using screen = await renderUi(
    // Offset from the viewport origin, where the popover's fixed focus guards sit.
    <div style={{ paddingLeft: "10rem" }}>
      {noticeRow(
        "20rem",
        <span>
          <Popover>
            <PopoverTrigger nativeButton={false} render={<span role="button" tabIndex={0} />}>
              Waiting on command
            </PopoverTrigger>
            <PopoverPopup>Output</PopoverPopup>
          </Popover>
        </span>,
      )}
    </div>,
  );

  await userEvent.click(screen.getByRole("button", { name: "Waiting on command" }));
  await expect.element(screen.getByText("Output")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Show details" }))
    .not.toBeInTheDocument();
});

it("shows the details button while text or nested text is cut, until it fits again", async () => {
  await using screen = await renderUi(noticeRow("4rem", "Waiting on a subagent with a long name"));
  const details = screen.getByRole("button", { name: "Show details" });
  await expect.element(details).toBeInTheDocument();

  await screen.rerender(noticeRow("4rem", "Ready"));
  await expect.element(details).not.toBeInTheDocument();

  await screen.rerender(noticeRow("4rem", "Waiting on a subagent with a long name"));
  await expect.element(details).toBeInTheDocument();

  screen.getByTestId("row").element().style.width = "40rem";
  await expect.element(details).not.toBeInTheDocument();

  await screen.rerender(
    noticeRow(
      "40rem",
      <span className="inline-block max-w-16 truncate align-bottom">A long nested name</span>,
    ),
  );
  await expect.element(details).toBeInTheDocument();

  await screen.rerender(
    <ComposerBanner.Root>
      {noticeRow("4rem", "Waiting on a subagent with a long name")}
    </ComposerBanner.Root>,
  );
  await expect.element(details).toBeInTheDocument();
  await screen.rerender(<ComposerBanner.Root>{noticeRow("4rem", "Ready")}</ComposerBanner.Root>);
  await expect.element(details).not.toBeInTheDocument();
});

it("opens the details of a long notice right above its button", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1280, 800);
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height),
  };
  const script = Array.from({ length: 400 }, (_, line) => `echo "line ${line}"`).join("\n");
  const container = document.createElement("div");
  container.style.cssText = "position: fixed; bottom: 4rem; right: 4rem;";
  await using screen = await renderUi(noticeRow("40rem", script), { container });
  const details = screen.getByRole("button", { name: "Show details" });
  await userEvent.hover(details);
  const popup = page.getByLabelText("Notice details");
  await expect.element(popup).toBeVisible();

  // A positioner sized to the unscrolled text flips beside the button and covers it.
  await vi.waitFor(() => {
    const gap =
      details.element().getBoundingClientRect().top -
      popup.element().getBoundingClientRect().bottom;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(8);
  });
});

it.each([
  { variant: "warning", announce: false, alert: true },
  { variant: "info", announce: false, alert: false },
  { variant: "info", announce: true, alert: true },
] as const)(
  "interrupts a screen reader for a $variant notice only when it needs the user: announce=$announce",
  async ({ variant, announce, alert }) => {
    await using screen = await renderUi(
      <ComposerBannerStack
        items={[{ id: "notice", variant, announce, icon: null, title: "Notice" }]}
      />,
    );
    await expect.element(screen.getByText("Notice", { exact: true })).toBeVisible();
    expect(screen.container.querySelector('[role="alert"]') !== null).toBe(alert);
  },
);
