import { act, render as renderUi, type Screen } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { usePresence } from "./usePresence";

function Harness({ value }: { value: string | null }) {
  const presence = usePresence(value);
  return presence.value === null ? null : (
    <p data-testid="item" {...presence.props}>
      {presence.value}
    </p>
  );
}

let screen: Screen;
let finishExit: () => void;

const render = (value: string | null) => screen.rerender(<Harness value={value} />);
const item = () => screen.container.querySelector("[data-testid=item]");

async function setupTest() {
  await using resources = new AsyncDisposableStack();
  const finished = new Promise<void>((resolve) => {
    finishExit = resolve;
  });
  resources.use(
    vi
      .spyOn(HTMLElement.prototype, "getAnimations")
      .mockImplementation(() => [{ finished }] as unknown as Animation[]),
  );
  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

HTMLElement.prototype.getAnimations ??= () => [];

describe("usePresence", () => {
  it("does not mark a value present on first paint as entering", async () => {
    await using _test = await setupTest();
    await render("first");
    expect(item()?.textContent).toBe("first");
    expect(item()?.hasAttribute("data-enter")).toBe(false);
  });

  it("keeps the last value mounted until its exit transition finishes", async () => {
    await using _test = await setupTest();
    await render("notice");
    await render(null);
    expect(item()?.textContent).toBe("notice");
    expect(item()?.hasAttribute("data-ending-style")).toBe(true);

    await act(async () => finishExit());
    expect(item()).toBeNull();
  });

  it("marks a value that arrives after mount as entering", async () => {
    await using _test = await setupTest();
    await render(null);
    await render("later");
    expect(item()?.hasAttribute("data-enter")).toBe(true);
    expect(item()?.hasAttribute("data-ending-style")).toBe(false);
  });

  it("cancels the exit when a value returns mid-transition", async () => {
    await using _test = await setupTest();
    await render("first");
    await render(null);
    await render("second");
    expect(item()?.textContent).toBe("second");
    expect(item()?.hasAttribute("data-ending-style")).toBe(false);

    await act(async () => finishExit());
    expect(item()?.textContent).toBe("second");
  });
});
