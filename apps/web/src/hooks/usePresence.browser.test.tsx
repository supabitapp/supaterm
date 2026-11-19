import { act, render as renderUi, type Screen } from "../../test/render";
import { describe, expect, it } from "vite-plus/test";

import { usePresence } from "./usePresence";

function Harness({ value }: { value: string | null }) {
  const presence = usePresence(value);
  return presence.value === null ? null : (
    <p
      data-testid="item"
      {...presence.props}
      style={{ transition: "opacity 60s linear", opacity: presence.exiting ? 0 : 1 }}
    >
      {presence.value}
    </p>
  );
}

let screen: Screen;

const item = () => screen.container.querySelector("[data-testid=item]");
const render = async (value: string | null) => {
  await screen.rerender(<Harness value={value} />);
  item()?.getBoundingClientRect();
};
const finishExit = () => {
  for (const animation of item()?.getAnimations() ?? []) animation.finish();
};

async function setupTest() {
  await using resources = new AsyncDisposableStack();
  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

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
    expect(item()?.getAnimations()).toHaveLength(1);

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
