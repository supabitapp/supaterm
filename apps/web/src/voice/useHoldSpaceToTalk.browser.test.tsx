import { useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers, render } from "../../test/render";
import { followKeyHold, KEY_HOLD_MS } from "./keyHold";
import { type ComposerDraft, type HoldSpaceToTalk, useHoldSpaceToTalk } from "./useHoldSpaceToTalk";

function Composer(props: { readonly handlers: HoldSpaceToTalk }) {
  const ref = useRef<HTMLDivElement>(null);
  useHoldSpaceToTalk(ref, props.handlers);
  return (
    <div ref={ref}>
      <div aria-label="Message" contentEditable role="textbox" suppressContentEditableWarning />
    </div>
  );
}

async function setup(initial: ComposerDraft) {
  let draft = initial;
  const release = vi.fn();
  const handlers = {
    canStart: vi.fn(() => true),
    readDraft: () => draft,
    restoreDraft: vi.fn((restored: ComposerDraft) => {
      draft = restored;
    }),
    start: vi.fn(),
    followPress: (onHold: () => void) => followKeyHold({ onHold, onHeldRelease: release }),
  };
  const screen = await render(<Composer handlers={handlers} />, { router: false });
  const editor = screen.getByLabelText("Message").element();
  /** Returns whether the key went through to the editor. */
  const key = (type: "keydown" | "keyup", init: KeyboardEventInit = {}) =>
    editor.dispatchEvent(
      new KeyboardEvent(type, { key: " ", bubbles: true, cancelable: true, ...init }),
    );
  /** Synthetic key events don't edit, so the test types what the editor would. */
  const type = (text: string) => {
    draft = { text, selection: { start: text.length, end: text.length } };
  };
  return { screen, handlers, release, key, type, draft: () => draft };
}

describe("useHoldSpaceToTalk", () => {
  it("leaves a tapped Space to type", async () => {
    const { screen, handlers, key, type, draft } = await setup({
      text: "hello",
      selection: { start: 5, end: 5 },
    });
    await using _screen = screen;
    using _timers = fakeTimers();

    expect(key("keydown")).toBe(true);
    type("hello ");
    key("keyup");
    vi.advanceTimersByTime(KEY_HOLD_MS);

    expect(handlers.start).not.toHaveBeenCalled();
    expect(draft().text).toBe("hello ");
  });

  it("takes back the space a held Space typed", async () => {
    const before = { text: "hello world", selection: { start: 5, end: 5 } };
    const { screen, handlers, release, key, type, draft } = await setup(before);
    await using _screen = screen;
    using _timers = fakeTimers();

    key("keydown");
    type("hello  world");
    expect(key("keydown", { repeat: true })).toBe(false);
    vi.advanceTimersByTime(KEY_HOLD_MS);

    expect(draft()).toEqual(before);
    expect(handlers.start).toHaveBeenCalledOnce();
    expect(key("keydown", { repeat: true })).toBe(false);
    key("keyup");
    expect(release).toHaveBeenCalledOnce();
    expect(key("keydown", { repeat: true })).toBe(true);
  });

  it("keeps a draft that changed for another reason while Space was held", async () => {
    const { screen, handlers, key, type, draft } = await setup({
      text: "hello",
      selection: { start: 5, end: 5 },
    });
    await using _screen = screen;
    using _timers = fakeTimers();

    key("keydown");
    type("hello world");
    vi.advanceTimersByTime(KEY_HOLD_MS);

    expect(handlers.restoreDraft).not.toHaveBeenCalled();
    expect(draft().text).toBe("hello world");
    expect(handlers.start).toHaveBeenCalledOnce();
  });

  it("leaves Space typing over a selection", async () => {
    const { screen, handlers, key } = await setup({
      text: "old text",
      selection: { start: 0, end: 3 },
    });
    await using _screen = screen;
    using _timers = fakeTimers();

    key("keydown");
    expect(key("keydown", { repeat: true })).toBe(true);
    vi.advanceTimersByTime(KEY_HOLD_MS);
    expect(handlers.start).not.toHaveBeenCalled();
  });

  it("treats Space as typing when another key follows it, while composing, or when voice can't start", async () => {
    const { screen, handlers, key } = await setup({ text: "", selection: { start: 0, end: 0 } });
    await using _screen = screen;
    using _timers = fakeTimers();

    key("keydown");
    key("keydown", { key: "a" });
    vi.advanceTimersByTime(KEY_HOLD_MS);
    expect(handlers.start).not.toHaveBeenCalled();

    key("keydown", { isComposing: true });
    expect(handlers.canStart).toHaveBeenCalledOnce();

    handlers.canStart.mockReturnValue(false);
    key("keydown");
    expect(key("keydown", { repeat: true })).toBe(true);
    vi.advanceTimersByTime(KEY_HOLD_MS);
    expect(handlers.start).not.toHaveBeenCalled();
  });
});
