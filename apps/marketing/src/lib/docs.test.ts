import { describe, expect, it } from "vite-plus/test";

import { rewriteUserDocHref, summarizeUserDoc } from "./docs";

describe("rewriteUserDocHref", () => {
  it.each([
    ["./remote-access.md", "/docs/remote-access"],
    ["remote-access.md#browser-host-setup", "/docs/remote-access#browser-host-setup"],
    ["#queued-messages", "#queued-messages"],
    [
      "../operations/development.md#first-checkout",
      "https://github.com/supabitapp/supaterm/blob/main/docs/operations/development.md#first-checkout",
    ],
    [
      "../../apps/mobile/README.md",
      "https://github.com/supabitapp/supaterm/blob/main/apps/mobile/README.md",
    ],
    ["https://example.com/a.md", "https://example.com/a.md"],
  ])("maps %s to %s", (href, expected) => {
    expect(rewriteUserDocHref(href)).toBe(expected);
  });
});

describe("summarizeUserDoc", () => {
  it("takes the H1 as the title and the first prose paragraph as plain text", () => {
    const body = [
      "# Remote access",
      "",
      "Connect a **phone** to `Supaterm` running\non a [different machine](./devices.md).",
      "",
      "## Pair",
    ].join("\n");
    expect(summarizeUserDoc(body)).toEqual({
      title: "Remote access",
      description: "Connect a phone to Supaterm running on a different machine.",
    });
  });
});
