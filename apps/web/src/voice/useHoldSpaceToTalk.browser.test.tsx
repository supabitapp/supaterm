import { useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers, render } from "../../test/render";
import { KEY_HOLD_MS } from "./keyHold";
import { type HoldSpaceToTalk, useHoldSpaceToTalk } from "./useHoldSpaceToTalk";

function Composer(props: { readonly handlers: HoldSpaceToTalk<string> }) {
  const ref = useRef<HTMLDivElement>(null);
  useHoldSpaceToTalk(ref, props.handlers);
  return (
    <div ref={ref}>
      <div aria-label="Message" contentEditable role="textbox" suppressContentEditableWarning />
    </div>
  );
}

async function setup(arm: () => string | null = () => "before") {
  const handlers = { arm: vi.fn(arm), hold: vi.fn(), release: vi.fn() };
  const screen = await render(<Composer handlers={handlers} />, { router: false });
  const editor = screen.getByLabelText("Message").element();
  /** Returns whether the key went through to the editor. */
  const key = (type: "keydown" | "keyup", init: KeyboardEventInit = {}) =>
    editor.dispatchEvent(
      new KeyboardEvent(type, { key: " ", bubbles: true, cancelable: true, ...init }),
    );
  return { screen, handlers, key };
}

describe("useHoldSpaceToTalk", () => {
  it("leaves a tapped Space to type", async () => {
    const { screen, handlers, key } = await setup();
    await using _screen = screen;
    using _timers = fakeTimers();

    expect(key("keydown")).toBe(true);
    key("keyup");
    vi.advanceTimersByTime(KEY_HOLD_MS);

    expect(handlers.hold).not.toHaveBeenCalled();
    expect(handlers.release).not.toHaveBeenCalled();
  });

  it("hands over the draft from before a held Space, swallowing its repeats until release", async () => {
    const { screen, handlers, key } = await setup();
    await using _screen = screen;
    using _timers = fakeTimers();

    expect(key("keydown")).toBe(true);
    expect(key("keydown", { repeat: true })).toBe(false);
    vi.advanceTimersByTime(KEY_HOLD_MS);
    expect(handlers.hold).toHaveBeenCalledExactlyOnceWith("before");
    expect(key("keydown", { repeat: true })).toBe(false);

    key("keyup");
    expect(handlers.release).toHaveBeenCalledOnce();
    expect(key("keydown", { repeat: true })).toBe(true);
  });

  it("treats Space as typing when another key follows it or voice can't start", async () => {
    const { screen, handlers, key } = await setup();
    await using _screen = screen;
    using _timers = fakeTimers();

    key("keydown");
    key("keydown", { key: "a" });
    vi.advanceTimersByTime(KEY_HOLD_MS);
    expect(handlers.hold).not.toHaveBeenCalled();

    key("keydown", { isComposing: true });
    expect(handlers.arm).toHaveBeenCalledOnce();

    handlers.arm.mockReturnValue(null);
    key("keydown");
    expect(key("keydown", { repeat: true })).toBe(true);
    vi.advanceTimersByTime(KEY_HOLD_MS);
    expect(handlers.hold).not.toHaveBeenCalled();
  });
});
