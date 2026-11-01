import { render } from "../../../test/render";
import "../../index.css";

import { createRef, type Ref, useImperativeHandle, useState } from "react";
import { flushSync } from "react-dom";
import { expect, it } from "vite-plus/test";

import { ScrollToEndPill } from "./ScrollToEndPill";

function Harness({ ref }: { ref: Ref<(bottom: number) => void> }) {
  const [bottom, setBottom] = useState(10);
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  useImperativeHandle(ref, () => setBottom);
  return (
    <div style={{ position: "relative", height: 400 }}>
      <ScrollToEndPill
        show
        bottom={bottom}
        composerOverlay={overlay}
        onScrollToEnd={() => undefined}
      />
      <div ref={setOverlay} data-testid="composer-overlay">
        <div data-testid="drawer" />
        <div data-chat-composer-main-surface="true" />
      </div>
    </div>
  );
}

it("rides the composer's height animation and otherwise moves at once", async () => {
  const setBottom = createRef<(bottom: number) => void>();
  await using screen = await render(<Harness ref={setBottom} />, { router: false });
  const pill = screen.container.querySelector<HTMLElement>(".chat-scroll-to-bottom")!;
  const drawer = screen.container.querySelector<HTMLElement>('[data-testid="drawer"]')!;
  const surface = screen.container.querySelector<HTMLElement>(
    '[data-chat-composer-main-surface="true"]',
  )!;
  const top = () => pill.getBoundingClientRect().top;
  const startTop = top();

  flushSync(() => setBottom.current?.(60));
  await Promise.resolve();
  expect(top()).toBe(startTop - 50);

  queueMicrotask(() => {
    drawer.animate([{ height: "0px" }, { height: "40px" }], { duration: 150 });
    surface.animate([{ height: "0px" }, { height: "100px" }], { duration: 200 });
  });
  flushSync(() => setBottom.current?.(110));
  flushSync(() => setBottom.current?.(160));
  expect(top()).toBe(startTop - 50);
  await Promise.resolve();
  expect(top()).toBe(startTop - 50);

  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = 150;
  }
  expect(top()).toBe(startTop - 125);
});
