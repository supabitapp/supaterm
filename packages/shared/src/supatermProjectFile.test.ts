import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { parseSupatermProjectFile, SupatermProjectFileFromJson } from "./supatermProjectFile.ts";

const decodeJson = Schema.decodeUnknownSync(SupatermProjectFileFromJson);

describe("SupatermProjectFileFromJson", () => {
  it("decodes lenient JSONC with comments and trailing commas", () => {
    const decoded = decodeJson(`{
      // team scripts
      "iconPath": "assets/logo.svg",
      "scripts": [
        { "name": "Dev", "command": "pnpm dev", },
      ],
    }`);

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts?.[0]).toEqual({ name: "Dev", command: "pnpm dev" });
  });
});

describe("parseSupatermProjectFile", () => {
  it("reads project defaults from JSONC with a URL in a block comment", () => {
    expect(
      parseSupatermProjectFile(`{
        /* See https://supaterm.sh/schema/supaterm.json */
        "defaultThreadEnvMode": "worktree"
      }`),
    ).toEqual({ defaultThreadEnvMode: "worktree" });
  });
});
