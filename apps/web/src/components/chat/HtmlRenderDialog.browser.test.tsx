import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { htmlRenderTheme, HTML_RENDER_DEFAULT_FONTS } from "@supaterm/shared/htmlRender";
import { SUPATERM_DARK_THEME_COLORS } from "@supaterm/shared/themePalettes";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
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
