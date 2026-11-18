import { describe, expect, it } from "vite-plus/test";

import { parseServerUrlFromOutput } from "./OpenCodeRuntime.ts";

describe("parseServerUrlFromOutput", () => {
  it.each([
    ["opencode server listening on http://127.0.0.1:4096", null],
    ["opencode server listening on http://127.0.0.1:40961\n", "http://127.0.0.1:40961"],
    ["opencode server listening on http://127.0.0.1:40961\r\n", "http://127.0.0.1:40961"],
  ])("reads only a newline-terminated ready line: %j", (output, expected) => {
    expect(parseServerUrlFromOutput(output)).toBe(expected);
  });
});
