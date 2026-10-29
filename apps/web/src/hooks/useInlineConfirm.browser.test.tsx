import { act, render as renderUi, fakeTimers, type Screen } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { clickOnFakeClock } from "~/test/inlineConfirm";
import { useInlineConfirm } from "./useInlineConfirm";

type Bound = ReturnType<ReturnType<typeof useInlineConfirm<"merge">>["bind"]>;

function Harness({
  run,
  show = true,
  onBind,
}: {
  run: () => void;
  show?: boolean;
  onBind?: (bound: Bound) => void;
}) {
  const confirm = useInlineConfirm<"merge">();
  const bound = confirm.bind("merge", run);
  onBind?.(bound);
  return (
    <>
      {show ? (
        <button type="button" {...bound}>
          {confirm.armed === "merge" ? "Confirm" : "Merge"}
        </button>
      ) : null}
      <p data-testid="outside">Elsewhere</p>
    </>
  );
}

let screen: Screen;
const run = vi.fn();

const render = (props: Partial<Parameters<typeof Harness>[0]> = {}) =>
  screen.rerender(<Harness run={run} {...props} />);
const button = () => screen.container.querySelector("button")!;
const press = () => act(() => clickOnFakeClock(button()));
const elapse = (ms: number) => act(() => vi.advanceTimersByTime(ms));

async function setupTest() {
  await using resources = new AsyncDisposableStack();
  resources.defer(() => {
    run.mockClear();
  });

  resources.use(fakeTimers({ now: 0 }));
  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

describe("useInlineConfirm", () => {
  it("runs only on a second press at least 250ms after arming", async () => {
    await using _test = await setupTest();
    await render();
    await press();
    expect(button().textContent).toBe("Confirm");
    await elapse(200);
    await press();
    expect(run).not.toHaveBeenCalled();
    await elapse(300);
    await press();
    expect(run).toHaveBeenCalledOnce();
    expect(button().textContent).toBe("Merge");
  });

  it("cancels on Escape without letting the page act on it", async () => {
    await using _test = await setupTest();
    const pageEscape = vi.fn();
    document.addEventListener("keydown", pageEscape);
    await render();
    await press();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(() => button().dispatchEvent(escape));
    document.removeEventListener("keydown", pageEscape);
    expect(button().textContent).toBe("Merge");
    expect(escape.defaultPrevented).toBe(true);
    expect(pageEscape).not.toHaveBeenCalled();
  });

  it("swallows a held Enter so key repeat cannot confirm", async () => {
    await using _test = await setupTest();
    await render();
    await press();
    const repeat = new KeyboardEvent("keydown", {
      key: "Enter",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    await act(() => button().dispatchEvent(repeat));
    expect(repeat.defaultPrevented).toBe(true);
    expect(button().textContent).toBe("Confirm");
  });

  it("cancels on a press elsewhere but not on the armed control", async () => {
    await using _test = await setupTest();
    await render();
    await press();
    await act(() => button().dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(button().textContent).toBe("Confirm");
    const outside = screen.container.querySelector("[data-testid=outside]")!;
    await act(() => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(button().textContent).toBe("Merge");
  });

  it("cancels after five seconds without a second press", async () => {
    await using _test = await setupTest();
    await render();
    await press();
    await elapse(4_999);
    expect(button().textContent).toBe("Confirm");
    await elapse(1);
    expect(button().textContent).toBe("Merge");
  });

  it("cancels when the armed control goes away", async () => {
    await using _test = await setupTest();
    await render();
    await press();
    await render({ show: false });
    await render({ show: true });
    expect(button().textContent).toBe("Merge");
    await press();
    expect(run).not.toHaveBeenCalled();
  });

  it("stops a surrounding Base UI handler only for presses that do not run", async () => {
    await using _test = await setupTest();
    let bound: Bound | undefined;
    await render({ onBind: (next) => (bound = next) });
    const arming = vi.fn();
    await act(() => bound!.onClick({ timeStamp: 0, preventBaseUIHandler: arming }));
    const confirming = vi.fn();
    await act(() => bound!.onClick({ timeStamp: 500, preventBaseUIHandler: confirming }));
    expect(arming).toHaveBeenCalledOnce();
    expect(confirming).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });
});
