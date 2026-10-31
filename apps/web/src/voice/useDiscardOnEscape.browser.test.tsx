import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { useDiscardOnEscape } from "./useDiscardOnEscape";

function Composer(props: { readonly discard: () => void; readonly inMenu?: boolean }) {
  useDiscardOnEscape(true, props.discard);
  const editor = (
    <input
      aria-label="Message"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.preventDefault();
      }}
    />
  );
  return props.inMenu ? <div role="menu">{editor}</div> : editor;
}

describe("useDiscardOnEscape", () => {
  it("discards while the focused editor handles Escape itself", async () => {
    const discard = vi.fn();
    await using screen = await render(<Composer discard={discard} />, { router: false });
    await screen.getByLabelText("Message").click();
    await userEvent.keyboard("{Escape}");
    expect(discard).toHaveBeenCalledOnce();
  });

  it("leaves Escape to an open menu", async () => {
    const discard = vi.fn();
    await using screen = await render(<Composer discard={discard} inMenu />, { router: false });
    await screen.getByLabelText("Message").click();
    await userEvent.keyboard("{Escape}");
    expect(discard).not.toHaveBeenCalled();
  });
});
