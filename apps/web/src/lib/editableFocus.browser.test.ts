import { afterEach, describe, expect, it } from "vite-plus/test";

import { isEditableFocused } from "./editableFocus";

afterEach(() => {
  document.body.replaceChildren();
});

describe("isEditableFocused", () => {
  it("sees a text field focused inside an open shadow root", () => {
    const host = document.createElement("div");
    const input = document.createElement("input");
    host.attachShadow({ mode: "open" }).append(input);
    document.body.append(host);

    expect(isEditableFocused(host)).toBe(false);
    input.focus();
    expect(isEditableFocused(host)).toBe(true);
    expect(isEditableFocused()).toBe(true);
  });
});
