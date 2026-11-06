import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { useDiscardOnEscape } from "./useDiscardOnEscape";

function Composer(props: {
  readonly discard: () => void;
  readonly onEditorEscape?: () => void;
  readonly inMenu?: boolean;
  readonly suggesting?: boolean;
}) {
  useDiscardOnEscape(true, props.discard);
  const editor = (
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
  );
  return props.inMenu ? (
    <div role="menu">{editor}</div>
  ) : (
    <>
      {editor}
      {props.suggesting ? (
        <ul id="suggestions" role="listbox">
          <li id="suggestion-1" role="option" aria-selected>
            /review
          </li>
        </ul>
      ) : null}
    </>
  );
}

describe("useDiscardOnEscape", () => {
  it("discards before the focused editor can take Escape, as a comment form closing", async () => {
    const discard = vi.fn();
    const onEditorEscape = vi.fn();
    await using screen = await render(
      <Composer discard={discard} onEditorEscape={onEditorEscape} />,
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
    await using screen = await render(<Composer discard={discard} inMenu />, { router: false });
    await screen.getByLabelText("Message").click();
    await userEvent.keyboard("{Escape}");
    expect(discard).not.toHaveBeenCalled();
  });
});
