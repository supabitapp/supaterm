import { act, render as renderUi, fakeTimers, type Screen } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { clickOnFakeClock } from "~/test/inlineConfirm";
import { InlineConfirmButton } from "./InlineConfirm";

let screen: Screen;
const onConfirm = vi.fn();

const render = (required: boolean) =>
  screen.rerender(
    <InlineConfirmButton
      size="xs"
      variant="ghost"
      required={required}
      label="Restore branch"
      confirmLabel="Confirm restore"
      tooltip="Switch back"
      confirmTooltip="Click again to switch back"
      onConfirm={onConfirm}
    />,
  );
const button = () => screen.container.querySelector("button")!;
const press = () => act(() => clickOnFakeClock(button()));

async function setupTest() {
  await using resources = new AsyncDisposableStack();
  resources.defer(() => {
    onConfirm.mockClear();
  });

  resources.use(fakeTimers({ now: 0 }));
  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

describe("InlineConfirmButton", () => {
  it("runs on the first press when no confirmation is required", async () => {
    await using _test = await setupTest();
    await render(false);
    await press();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("asks for a second press when a confirmation is required", async () => {
    await using _test = await setupTest();
    await render(true);
    await press();
    expect(onConfirm).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTime(500));
    await press();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("drops a pending confirmation once it is no longer required", async () => {
    await using _test = await setupTest();
    await render(true);
    await press();
    await render(false);
    await render(true);
    await act(() => vi.advanceTimersByTime(500));
    await press();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
