import { describe, expect, it } from "vite-plus/test";

import { openCodePermissionRequestKind } from "./kinds.ts";

describe("openCodePermissionRequestKind", () => {
  it.each([
    { name: "an edit", permission: "edit", kind: "file-change" },
    { name: "an external directory", permission: "external_directory", kind: "file-read" },
    { name: "a shell command", permission: "bash", kind: "command" },
    { name: "a patch tool", permission: "ask", toolName: "apply_patch", kind: "file-change" },
    { name: "a search tool", permission: "ask", toolName: "codebase_search", kind: "file-read" },
  ])("asks for $name as $kind", ({ permission, toolName, kind }) => {
    expect(openCodePermissionRequestKind(permission, toolName)).toBe(kind);
  });
});
