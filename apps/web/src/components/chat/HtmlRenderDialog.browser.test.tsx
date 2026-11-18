import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { htmlRenderTheme, HTML_RENDER_DEFAULT_FONTS } from "@supaterm/shared/htmlRender";
import { SUPATERM_DARK_THEME_COLORS } from "@supaterm/shared/themePalettes";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";

import "~/index.css";

import { act, render as renderUi } from "../../../test/render";
import { HtmlRenderDialog } from "./HtmlRenderDialog";
import { HtmlRenderFrame } from "./HtmlRenderFrame";

const { cachedUrl, refresh, showError, openLink, openChangeRequestLink } = vi.hoisted(() => ({
  cachedUrl: { lifeMs: 60 * 60_000 },
  refresh: vi.fn(),
  showError: vi.fn(),
  openLink: vi.fn(),
  openChangeRequestLink: vi.fn(),
}));
vi.mock(import("~/browser/useOpenLink"), async (original) => ({
  ...(await original()),
  useOpenLink: () => openLink,
}));
vi.mock(import("~/lib/openPullRequestLink"), async (original) => ({
  ...(await original()),
  useOpenChangeRequestLink: () => openChangeRequestLink,
}));
vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlRefresh: () => refresh,
}));
vi.mock(import("~/assets/longLivedAssetUrls"), async (original) => ({
  ...(await original()),
  useLongLivedAssetUrl: () => ({
    _tag: "Success",
    url: "https://environment.test/original.html",
    expiresAt: Date.now() + cachedUrl.lifeMs,
  }),
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: showError } };
});
vi.mock(import("~/hooks/useHtmlRenderTheme"), async (original) => ({
  ...(await original()),
  useHtmlRenderTheme: () =>
    htmlRenderTheme(SUPATERM_DARK_THEME_COLORS, "dark", HTML_RENDER_DEFAULT_FONTS),
}));

const onClose = vi.fn();
const onOpen = vi.fn();

function setup() {
  refresh.mockReset();
  cachedUrl.lifeMs = 60 * 60_000;
  openLink.mockReset().mockResolvedValue(undefined);
  openChangeRequestLink.mockReset().mockReturnValue(false);
  showError.mockClear();
  onClose.mockClear();
  onOpen.mockClear();
}

function button(label: string) {
  return page.getByRole("button", { name: label, exact: true });
}

// A trusted click, so the page also gets the user activation the link handler requires.
async function click(label: string) {
  await button(label).click();
}

async function renderInline() {
  return renderUi(
    <HtmlRenderFrame
      environmentId={EnvironmentId.make("environment")}
      htmlRender={{ attachmentId: "html", title: "Diagram", height: 400 }}
      threadRef={{
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make("thread"),
      }}
      onOpen={onOpen}
    />,
  );
}

it("opens the page in the panel beside the full screen action", async () => {
  setup();
  await using _screen = await renderInline();
  await click("Open in panel");
  expect(onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ id: "html", mimeType: "text/html", htmlRender: true }),
  );
  expect(refresh).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("opens full screen with the inline URL while keeping the inline page loaded", async () => {
  setup();
  await using _screen = await renderInline();
  const inlineFrame = document.querySelector("iframe")!;
  const originalSrc = inlineFrame.src;
  const expandButton = document.querySelector<HTMLButtonElement>(
    '[aria-label="Open full screen"]',
  )!;
  expandButton.focus();
  await click("Open full screen");
  expect(refresh).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"] iframe')?.getAttribute("src")).toContain(
    "https://environment.test/original.html#",
  );
  expect(inlineFrame.src).toBe(originalSrc);
  await click("Close");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector("iframe")).toBe(inlineFrame);
  expect(document.activeElement).toBe(expandButton);
});

const dialog = (
  <HtmlRenderDialog
    src="https://environment.test/page.html"
    htmlRender={{ attachmentId: "html", title: "Diagram", height: 400 }}
    onClose={() => {}}
  />
);

function frameAndCard() {
  const frame = document.querySelector<HTMLIFrameElement>('[role="dialog"] iframe')!;
  let card = frame.parentElement!;
  while (getComputedStyle(card).overflowY !== "auto") card = card.parentElement!;
  return { frame, card };
}

async function reportHeight(frame: HTMLIFrameElement, height: number) {
  await act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height } },
      }),
    );
  });
}

it("fits the frame to the page's height and scrolls only the card", async () => {
  await page.viewport(1280, 800);
  await using _screen = await renderUi(dialog);
  const { frame, card } = frameAndCard();
  await reportHeight(frame, 300);
  expect(frame.getBoundingClientRect().height).toBe(300);
  expect(card.scrollHeight).toBe(card.clientHeight);
  await reportHeight(frame, 5000);
  expect(frame.getBoundingClientRect().height).toBe(5000);
  expect(card.clientHeight).toBeLessThan(800);
  expect(card.scrollHeight).toBeGreaterThan(card.clientHeight);
});

it("zooms by reflowing the page to the card's width instead of overflowing it", async () => {
  await page.viewport(1280, 800);
  await using _screen = await renderUi(dialog);
  const { frame, card } = frameAndCard();
  await reportHeight(frame, 300);
  const contentWidth = frame.getBoundingClientRect().width;
  for (let step = 0; step < 4; step += 1) {
    await userEvent.click(page.getByRole("button", { name: "Zoom in" }));
  }
  expect(frame.getBoundingClientRect().width).toBeCloseTo(contentWidth, 0);
  expect(frame.getBoundingClientRect().height).toBe(600);
  expect(card.scrollWidth).toBe(card.clientWidth);
  await userEvent.click(page.getByRole("button", { name: "Reset zoom" }));
  for (let step = 0; step < 2; step += 1) {
    await userEvent.click(page.getByRole("button", { name: "Zoom out" }));
  }
  expect(frame.getBoundingClientRect().width).toBeCloseTo(contentWidth, 0);
  expect(frame.getBoundingClientRect().height).toBe(150);
});
