import { describe, expect, it } from "vite-plus/test";

import { isDefaultCopiedFile } from "./addProjectToMachine";

describe("isDefaultCopiedFile", () => {
  it("selects env files anywhere in the tree", () => {
    expect(
      [".env", "apps/web/.env.local", ".envrc", ".dev.vars", "dist.log", ".environment"].filter(
        isDefaultCopiedFile,
      ),
    ).toEqual([".env", "apps/web/.env.local", ".envrc", ".dev.vars"]);
  });
});
