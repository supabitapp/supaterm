import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { MarkdownTable } from "./MarkdownTable";

function withoutAsyncClipboard() {
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  const execCommand = vi.spyOn(document, "execCommand").mockReturnValue(true);
  return {
    execCommand,
    [Symbol.dispose]() {
      execCommand.mockRestore();
      Reflect.deleteProperty(navigator, "clipboard");
      if (original) Object.defineProperty(Navigator.prototype, "clipboard", original);
    },
  };
}

describe("markdown copy without the async clipboard", () => {
  it("copies a code block through the execCommand fallback", async () => {
    await using screen = await render(
      <MarkdownCodeBlock
        code="echo hi"
        language="sh"
        fenceTitle={null}
        theme="light"
        isStreaming={false}
      >
        <pre>
          <code>echo hi</code>
        </pre>
      </MarkdownCodeBlock>,
      { router: false },
    );
    using clipboard = withoutAsyncClipboard();

    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await expect.element(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(clipboard.execCommand).toHaveBeenCalledWith("copy");
  });

  it("copies a table through the execCommand fallback", async () => {
    await using screen = await render(
      <MarkdownTable>
        <thead>
          <tr>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Ada</td>
          </tr>
        </tbody>
      </MarkdownTable>,
      { router: false },
    );
    using clipboard = withoutAsyncClipboard();

    await userEvent.click(screen.getByRole("button", { name: "Copy table" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Copy as Markdown" }));
    await expect.element(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(clipboard.execCommand).toHaveBeenCalledWith("copy");
  });
});
