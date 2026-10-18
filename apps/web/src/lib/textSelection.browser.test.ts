import { afterEach, describe, expect, it } from "vite-plus/test";
import { hasTextSelection } from "./textSelection";

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("hasTextSelection", () => {
  it("distinguishes selected conversation text from a collapsed caret", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Copy this response";
    document.body.append(paragraph);
    expect(hasTextSelection()).toBe(false);

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    document.getSelection()?.addRange(range);
    expect(hasTextSelection()).toBe(true);

    document.getSelection()?.collapseToEnd();
    expect(hasTextSelection()).toBe(false);
  });

  it.each(["input", "textarea"] as const)("detects selection in a focused %s", (tagName) => {
    const input = document.createElement(tagName);
    input.value = "Copy this draft";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(0, 4);
    expect(hasTextSelection()).toBe(true);

    input.setSelectionRange(4, 4);
    expect(hasTextSelection()).toBe(false);
  });

  it("detects a focused input selection inside an open shadow root", () => {
    const host = document.createElement("div");
    const input = document.createElement("input");
    input.value = "Copy this draft";
    host.attachShadow({ mode: "open" }).append(input);
    document.body.append(host);
    input.focus();
    input.select();
    expect(hasTextSelection()).toBe(true);
  });

  it("handles focused inputs without text selection support", () => {
    const input = document.createElement("input");
    input.type = "number";
    document.body.append(input);
    input.focus();
    expect(hasTextSelection()).toBe(false);
  });
});
