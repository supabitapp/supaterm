import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { Input } from "./input";

function HighlightedSuggestion(props: {
  readonly claimTab?: boolean;
  readonly readOnly?: boolean;
  readonly onEnter: () => void;
}) {
  return (
    <>
      <Input
        nativeInput
        role="combobox"
        aria-label="Search"
        aria-activedescendant="suggestion"
        readOnly={props.readOnly}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.onEnter();
          if (event.key === "Tab" && props.claimTab) event.preventBaseUIHandler?.();
        }}
      />
      <button type="button">Next</button>
    </>
  );
}

it.each([
  { name: "accepts the highlighted suggestion", options: {}, enters: 1, focused: "combobox" },
  {
    name: "leaves Tab to a field that claims it",
    options: { claimTab: true },
    enters: 0,
    focused: "button",
  },
  {
    name: "leaves Tab alone in a read-only field",
    options: { readOnly: true },
    enters: 0,
    focused: "button",
  },
] as const)("Tab $name", async ({ options, enters, focused }) => {
  const onEnter = vi.fn();
  await using screen = await render(<HighlightedSuggestion {...options} onEnter={onEnter} />);
  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.keyboard("{Tab}");
  expect(onEnter).toHaveBeenCalledTimes(enters);
  await expect.element(screen.getByRole(focused)).toHaveFocus();
});
