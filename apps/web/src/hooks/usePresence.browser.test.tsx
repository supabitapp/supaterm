import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { usePresence } from "./usePresence";

function Harness({ value }: { value: string | null }) {
  const presence = usePresence(value);
  return presence.value === null ? null : (
    <p data-testid="item" {...presence.props}>
      {presence.value}
    </p>
  );
}

let root: Root;
let container: HTMLDivElement;
let finishExit: () => void;

const render = (value: string | null) => act(() => root.render(<Harness value={value} />));
const item = () => container.querySelector("[data-testid=item]");
const nextFrame = () => act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const finished = new Promise<void>((resolve) => {
    finishExit = resolve;
  });
  vi.spyOn(HTMLElement.prototype, "getAnimations").mockImplementation(
    () => [{ finished }] as unknown as Animation[],
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

HTMLElement.prototype.getAnimations ??= () => [];

describe("usePresence", () => {
  it("does not mark a value present on first paint as entering", async () => {
    await render("first");
    expect(item()?.textContent).toBe("first");
    expect(item()?.hasAttribute("data-enter")).toBe(false);
  });

  it("keeps the last value mounted until its exit transition finishes", async () => {
    await render("notice");
    await render(null);
    expect(item()?.textContent).toBe("notice");
    expect(item()?.hasAttribute("data-ending-style")).toBe(true);

    await nextFrame();
    await act(async () => finishExit());
    expect(item()).toBeNull();
  });

  it("marks a value that arrives after mount as entering", async () => {
    await render(null);
    await render("later");
    expect(item()?.hasAttribute("data-enter")).toBe(true);
    expect(item()?.hasAttribute("data-ending-style")).toBe(false);
  });

  it("cancels the exit when a value returns mid-transition", async () => {
    await render("first");
    await render(null);
    await render("second");
    expect(item()?.textContent).toBe("second");
    expect(item()?.hasAttribute("data-ending-style")).toBe(false);

    await nextFrame();
    await act(async () => finishExit());
    expect(item()?.textContent).toBe("second");
  });
});
