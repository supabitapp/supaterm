import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

let root: Root;
let container: HTMLDivElement;
const run = vi.fn();

const render = (props: Partial<Parameters<typeof Harness>[0]> = {}) =>
  act(() => root.render(<Harness run={run} {...props} />));
const button = () => container.querySelector("button")!;
const press = () => act(() => clickOnFakeClock(button()));
const elapse = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ now: 0 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  run.mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useInlineConfirm", () => {
  it("runs only on a second press at least 400ms after arming", () => {
    render();
    press();
    expect(button().textContent).toBe("Confirm");
    elapse(200);
    press();
    expect(run).not.toHaveBeenCalled();
    elapse(300);
    press();
    expect(run).toHaveBeenCalledOnce();
    expect(button().textContent).toBe("Merge");
  });

  it("cancels on Escape without letting the page act on it", () => {
    const pageEscape = vi.fn();
    document.addEventListener("keydown", pageEscape);
    render();
    press();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => button().dispatchEvent(escape));
    document.removeEventListener("keydown", pageEscape);
    expect(button().textContent).toBe("Merge");
    expect(escape.defaultPrevented).toBe(true);
    expect(pageEscape).not.toHaveBeenCalled();
  });

  it("swallows a held Enter so key repeat cannot confirm", () => {
    render();
    press();
    const repeat = new KeyboardEvent("keydown", {
      key: "Enter",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => button().dispatchEvent(repeat));
    expect(repeat.defaultPrevented).toBe(true);
    expect(button().textContent).toBe("Confirm");
  });

  it("cancels on a press elsewhere but not on the armed control", () => {
    render();
    press();
    act(() => button().dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(button().textContent).toBe("Confirm");
    const outside = container.querySelector("[data-testid=outside]")!;
    act(() => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(button().textContent).toBe("Merge");
  });

  it("cancels after five seconds without a second press", () => {
    render();
    press();
    elapse(4_999);
    expect(button().textContent).toBe("Confirm");
    elapse(1);
    expect(button().textContent).toBe("Merge");
  });

  it("cancels when the armed control goes away", () => {
    render();
    press();
    render({ show: false });
    render({ show: true });
    expect(button().textContent).toBe("Merge");
    press();
    expect(run).not.toHaveBeenCalled();
  });

  it("stops a surrounding Base UI handler only for presses that do not run", () => {
    let bound: Bound | undefined;
    render({ onBind: (next) => (bound = next) });
    const arming = vi.fn();
    act(() => bound!.onClick({ timeStamp: 0, preventBaseUIHandler: arming }));
    const confirming = vi.fn();
    act(() => bound!.onClick({ timeStamp: 500, preventBaseUIHandler: confirming }));
    expect(arming).toHaveBeenCalledOnce();
    expect(confirming).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });
});
