import { expect, it } from "vite-plus/test";

import { LAYOUT_SHIFT_EVENT, type LayoutShift, revealHeightChange } from "~/lib/layoutShift";
import { render } from "../../../test/render";
import { ComposerSurface } from "./ComposerSurface";

it("paints its own surfaces until the last of two overlapping reveals ends", async () => {
  await using screen = await render(
    <ComposerSurface.Shell>
      <ComposerSurface.Host>
        <ComposerSurface.Main>
          <div data-tray style={{ height: 80 }} />
        </ComposerSurface.Main>
      </ComposerSurface.Host>
    </ComposerSurface.Shell>,
  );
  const shell = screen.container.querySelector('[data-slot="composer-shell"]')!;
  const tray = screen.container.querySelector<HTMLElement>("[data-tray]")!;
  const shifts: LayoutShift[] = [];
  shell.addEventListener(LAYOUT_SHIFT_EVENT, (event) => {
    if (event instanceof CustomEvent) shifts.push(event.detail);
  });
  const paintsOwnSurfaces = () => shell.hasAttribute("data-model-strip-transition");

  const first = revealHeightChange(tray, 40, 80, 40, "bottom");
  first.stop();
  const second = revealHeightChange(tray, 60, 80, 80, "bottom");
  await shifts[0]!.settled;
  expect(paintsOwnSurfaces()).toBe(true);

  second.stop();
  await shifts[1]!.settled;
  expect(paintsOwnSurfaces()).toBe(false);
});
