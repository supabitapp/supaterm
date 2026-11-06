import { useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers, render } from "../../test/render";
import { followKeyHold, KEY_HOLD_MS } from "./keyHold";
import { type ComposerDraft, type HoldToTalk, useHoldToTalk } from "./useHoldToTalk";

type Editor = "rich" | "textarea";

function Composer(props: {
  readonly holdKey: "alt" | "space";
  readonly editor: Editor;
  readonly handlers: HoldToTalk;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useHoldToTalk(ref, props.holdKey, props.handlers);
  return (
    <div ref={ref}>
      {props.editor === "textarea" ? (
        <textarea aria-label="Message" />
      ) : (
        <div aria-label="Message" contentEditable role="textbox" suppressContentEditableWarning />
      )}
    </div>
  );
}

async function setup(
  initial: ComposerDraft,
  holdKey: "alt" | "space" = "space",
  editorKind: Editor = "rich",
) {
  let draft = initial;
  const release = vi.fn();
  const handlers = {
    canStart: vi.fn(() => true),
    readDraft: () => draft,
    restoreDraft: vi.fn((restored: ComposerDraft) => {
      draft = restored;
    }),
    opening: vi.fn(() => false),
    start: vi.fn(),
    finish: release,
    cancel: vi.fn(),
    followPress: followKeyHold,
  };
  const screen = await render(
    <Composer holdKey={holdKey} editor={editorKind} handlers={handlers} />,
    {
      router: false,
    },
  );
  const editor = screen.getByLabelText("Message").element();
  /** Returns whether the key went through to the editor. */
  const key = (type: "keydown" | "keyup", init: KeyboardEventInit = {}) =>
    editor.dispatchEvent(
      new KeyboardEvent(type, {
        key: " ",
        code: "Space",
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  /** Synthetic key events don't edit, so the test types what the editor would. */
  const type = (text: string) => {
    draft = { text, selection: { start: text.length, end: text.length } };
  };
  return { screen, editor, handlers, release, key, type, draft: () => draft };
}

const EMPTY_DRAFT: ComposerDraft = { text: "", selection: { start: 0, end: 0 } };
const ALT = { key: "Alt", code: "AltLeft", altKey: true } as const;
const ALT_UP = { key: "Alt", code: "AltLeft" } as const;
const OPTION_LEFT = { key: "ArrowLeft", code: "ArrowLeft", altKey: true } as const;

describe("useHoldToTalk", () => {
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

  it.each(["rich", "textarea"] as const)(
    "takes back the space a held Space typed in a %s editor",
    async (editor) => {
      const before = { text: "hello world", selection: { start: 5, end: 5 } };
      const { screen, handlers, release, key, type, draft } = await setup(before, "space", editor);
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
    },
  );

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

  it("records while Alt is held and consumes its release", async () => {
    const { screen, handlers, release, key } = await setup(EMPTY_DRAFT, "alt");
    await using _screen = screen;
    using _timers = fakeTimers();

    key("keydown", ALT);
    key("keyup", ALT_UP);
    vi.advanceTimersByTime(KEY_HOLD_MS);
    expect(handlers.start).not.toHaveBeenCalled();

    key("keydown", ALT);
    vi.advanceTimersByTime(KEY_HOLD_MS);
    key("keydown", { ...ALT, repeat: true });
    expect(handlers.start).toHaveBeenCalledOnce();
    expect(key("keyup", ALT_UP)).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    expect(handlers.cancel).not.toHaveBeenCalled();
  });

  it("takes back a held Alt let go before the microphone opens", async () => {
    const { screen, handlers, release, key } = await setup(EMPTY_DRAFT, "alt");
    await using _screen = screen;
    using _timers = fakeTimers();
    handlers.opening.mockReturnValue(true);

    key("keydown", ALT);
    vi.advanceTimersByTime(KEY_HOLD_MS);
    key("keyup", ALT_UP);

    expect(handlers.cancel).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });

  it("leaves Alt to chords pressed before it is held, or with another modifier down", async () => {
    const { screen, handlers, key } = await setup(EMPTY_DRAFT, "alt");
    await using _screen = screen;
    using _timers = fakeTimers();

    key("keydown", ALT);
    key("keydown", OPTION_LEFT);
    vi.advanceTimersByTime(KEY_HOLD_MS);
    key("keydown", ALT);
    key("keydown", { key: "Backspace", code: "Backspace", altKey: true, repeat: true });
    vi.advanceTimersByTime(KEY_HOLD_MS);
    key("keydown", { ...ALT, shiftKey: true });
    vi.advanceTimersByTime(KEY_HOLD_MS);

    expect(handlers.start).not.toHaveBeenCalled();
  });

  it("takes back a held Alt that joins a chord, a click, or a switch away", async () => {
    const { screen, editor, handlers, release, key } = await setup(EMPTY_DRAFT, "alt");
    await using _screen = screen;
    using _timers = fakeTimers();
    const interruptions = [
      () => key("keydown", OPTION_LEFT),
      () => editor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
      () => window.dispatchEvent(new Event("blur")),
    ];

    for (const [index, interrupt] of interruptions.entries()) {
      key("keydown", ALT);
      vi.advanceTimersByTime(KEY_HOLD_MS);
      interrupt();
      key("keyup", ALT_UP);
      expect(handlers.start).toHaveBeenCalledTimes(index + 1);
      expect(handlers.cancel).toHaveBeenCalledTimes(index + 1);
    }
    expect(release).not.toHaveBeenCalled();
  });
});
