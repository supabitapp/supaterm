import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";
import { BrowserSurfaceSlot } from "../browser/BrowserSurfaceSlot";
import { useBrowserSurfaceStore } from "../browser/browserSurfaceStore";
import { resolveHostedBrowserWebviewWrapperStyle } from "../browser/hostedBrowserWebviewStyle";
import { RightPanelSheet } from "./RightPanelSheet";

it("names the open right-panel dialog", async () => {
  await using _screen = await render(
    <RightPanelSheet open animationDurationMs={0} onClose={() => {}}>
      <div>Panel content</div>
    </RightPanelSheet>,
  );
  const dialog = page.getByRole("dialog");
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog).not.toHaveAccessibleName("");
});

function HostedPage(props: { readonly tabId: string }) {
  const presentation = useBrowserSurfaceStore((state) => state.byTabId[props.tabId]);
  if (presentation?.visible !== true || presentation.rect === null) return null;
  return (
    <div
      data-testid="hosted-page"
      className="fixed"
      style={resolveHostedBrowserWebviewWrapperStyle({
        active: true,
        renderingActive: true,
        rect: presentation.rect,
        zIndex: presentation.zIndex,
        hiddenSize: presentation.rect,
      })}
    />
  );
}

it("shows a desktop page above the sheet that holds it in the default 1100 px window", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1100, 780);
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height),
  };
  await using _screen = await render(
    <>
      <RightPanelSheet open animationDurationMs={0} onClose={() => {}}>
        <BrowserSurfaceSlot tabId="sheet-page" visible className="h-64 w-full" />
      </RightPanelSheet>
      <HostedPage tabId="sheet-page" />
    </>,
  );

  const hostedPage = page.getByTestId("hosted-page");
  await expect.element(hostedPage).toBeVisible();
  const box = hostedPage.element().getBoundingClientRect();
  expect(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)).toBe(
    hostedPage.element(),
  );
});
