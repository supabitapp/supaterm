import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { clickOnFakeClock } from "~/test/inlineConfirm";
import { InlineConfirmButton } from "./InlineConfirm";

let root: Root;
let container: HTMLDivElement;
const onConfirm = vi.fn();

const render = (required: boolean) =>
  act(() =>
    root.render(
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
    ),
  );
const button = () => container.querySelector("button")!;
const press = () => act(() => clickOnFakeClock(button()));

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
  onConfirm.mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("InlineConfirmButton", () => {
  it("runs on the first press when no confirmation is required", () => {
    render(false);
    press();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("asks for a second press when a confirmation is required", () => {
    render(true);
    press();
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    press();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("drops a pending confirmation once it is no longer required", () => {
    render(true);
    press();
    render(false);
    render(true);
    act(() => vi.advanceTimersByTime(500));
    press();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
