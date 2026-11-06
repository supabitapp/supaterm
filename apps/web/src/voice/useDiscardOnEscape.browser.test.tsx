import { useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { useDiscardOnEscape } from "./useDiscardOnEscape";

function Composer(props: {
  readonly discard: () => void;
  readonly onEditorEscape?: () => void;
  readonly menuBeside?: boolean;
  readonly inDialog?: boolean;
  readonly suggesting?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useDiscardOnEscape(true, props.discard, formRef);
  const form = (
    <form ref={formRef}>
      <input
        aria-label="Message"
        {...(props.suggesting
          ? { "aria-controls": "suggestions", "aria-activedescendant": "suggestion-1" }
          : {})}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          props.onEditorEscape?.();
        }}
      />
      {props.suggesting ? (
        <ul id="suggestions" role="listbox">
          <li id="suggestion-1" role="option" aria-selected>
            /review
          </li>
        </ul>
      ) : null}
    </form>
  );
  return (
    <>
      {props.inDialog ? <div role="dialog">{form}</div> : form}
      {props.menuBeside ? (
        <div role="menu">
          <input aria-label="Menu search" />
        </div>
      ) : null}
    </>
  );
}

describe("useDiscardOnEscape", () => {
  it.each([
    ["in the composer", false],
    ["in a field inside a popover", true],
  ])("discards before the focused field can take Escape, %s", async (_case, inDialog) => {
    const discard = vi.fn();
    const onEditorEscape = vi.fn();
    await using screen = await render(
      <Composer discard={discard} onEditorEscape={onEditorEscape} inDialog={inDialog} />,
      { router: false },
    );
    await screen.getByLabelText("Message").click();
    await userEvent.keyboard("{Escape}");
    expect(discard).toHaveBeenCalledOnce();
    expect(onEditorEscape).not.toHaveBeenCalled();
  });

  it("leaves Escape to the editor's open suggestion list", async () => {
    const discard = vi.fn();
    await using screen = await render(<Composer discard={discard} suggesting />, {
      router: false,
    });
    await screen.getByLabelText("Message").click();
    await userEvent.keyboard("{Escape}");
    expect(discard).not.toHaveBeenCalled();
  });

  it("leaves Escape to an open menu", async () => {
    const discard = vi.fn();
    await using screen = await render(<Composer discard={discard} menuBeside />, {
      router: false,
    });
    await screen.getByLabelText("Menu search").click();
    await userEvent.keyboard("{Escape}");
    expect(discard).not.toHaveBeenCalled();
  });
});
