import { ThreadId, TurnItemId } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import {
  MAX_TOOL_OUTPUT_IMAGES,
  MAX_TOOL_OUTPUT_IMAGE_BASE64_LENGTH,
  toolOutputImages,
} from "@supaterm/shared/toolOutput";

import { openCodeToolOutput, openCodeToolTurnItem } from "./toolItems.ts";

describe("openCodeToolOutput", () => {
  it("preserves inline raster file content and leaves other files unserved", () => {
    const output = openCodeToolOutput("Preview complete", [
      { uri: "https://example.com/preview.png", mime: "image/png" },
      { uri: "file:///tmp/preview.png", mime: "image/png" },
      { uri: "data:image/svg+xml;base64,AAAA", mime: "image/svg+xml" },
      { uri: "data:image/png;base64,AAAA", mime: "image/jpeg" },
      { uri: "data:image/png;base64,", mime: "image/png" },
      { uri: "data:image/png;base64,iVBORw0KGgo=", mime: "image/png" },
    ]);
    expect(toolOutputImages(output)).toEqual([{ mimeType: "image/png", data: "iVBORw0KGgo=" }]);
    expect(output).toEqual({
      content: [
        { type: "text", text: "Preview complete" },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
      ],
    });
    expect(openCodeToolOutput("Text result")).toBe("Text result");
    const oversized = "A".repeat(MAX_TOOL_OUTPUT_IMAGE_BASE64_LENGTH + 4);
    const bounded = openCodeToolOutput(
      "Preview complete",
      Array.from({ length: MAX_TOOL_OUTPUT_IMAGES + 2 }, (_, index) => ({
        uri: `data:image/png;base64,${index === 0 ? oversized : "AQ=="}`,
        mime: "image/png",
      })),
    );
    expect(typeof bounded === "object" ? bounded.content.length : 0).toBe(
      MAX_TOOL_OUTPUT_IMAGES + 1,
    );
    const images = toolOutputImages(bounded);
    expect(images[0]?.data?.length).toBe(oversized.length);
    expect(images[1]?.data).toBe("AQ==");
  });
});

describe("openCodeToolTurnItem", () => {
  const base = (title: string) => ({
    id: TurnItemId.make("tool-item"),
    threadId: ThreadId.make("thread"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed" as const,
    title,
    startedAt: null,
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-11-04T00:00:00Z"),
  });

  it.each([
    {
      name: "deletion",
      toolName: "edit",
      input: { oldString: "old\n", newString: "", newText: "fallback" },
      expected: { oldStr: "old\n", newStr: "" },
    },
    {
      name: "whitespace replacement",
      toolName: "edit",
      input: { oldString: " \t", newString: "\n\t" },
      expected: { oldStr: " \t", newStr: "\n\t" },
    },
    {
      name: "empty write",
      toolName: "write",
      input: { content: "" },
      expected: { newStr: "" },
    },
  ])("preserves exact file content for $name", ({ toolName, input, expected }) => {
    const item = openCodeToolTurnItem(base(toolName), {
      name: toolName,
      input: { filePath: "src/index.ts", ...input },
      output: undefined,
      completedMetadata: undefined,
    });
    expect(item).toMatchObject({ type: "file_change", fileName: "src/index.ts", ...expected });
  });

  const directory =
    "<path>/workspace/src</path>\n<type>directory</type>\n<entries>\nenv.ts\nlib/\n\n(2 entries)\n</entries>";
  const file =
    "<path>/workspace/src/env.ts</path>\n<type>file</type>\n<content>\n1: hello\n2: </content> literal\n3: world\n</content>";
  const missingPath = directory.slice(directory.indexOf("<type>"));
  const missingClose = file.slice(0, file.lastIndexOf("\n</content>"));

  it.each([
    {
      name: "a read without an envelope",
      tool: "read",
      input: { filePath: "src/env.ts" },
      output: "---\nfile body",
      expected: { type: "dynamic_tool", title: "Read src/env.ts", output: "---\nfile body" },
    },
    {
      name: "a directory read",
      tool: "read",
      input: { filePath: "/workspace/src" },
      output: directory,
      expected: { type: "dynamic_tool", output: "env.ts\nlib/\n\n(2 entries)" },
    },
    {
      name: "a file read with a closing tag in its text",
      tool: "read",
      input: { filePath: "/workspace/src/env.ts" },
      output: file,
      expected: { type: "dynamic_tool", output: "1: hello\n2: </content> literal\n3: world" },
    },
    {
      name: "a file read followed by instructions",
      tool: "read",
      input: { filePath: "/workspace/src/env.ts" },
      output:
        "<path>/workspace/src/env.ts</path>\n<type>file</type>\n<content>1: hello\n\n(End of file - total 1 lines)\n</content>\n\n<system-reminder>\nProject instructions\n</system-reminder>",
      expected: {
        type: "dynamic_tool",
        output:
          "1: hello\n\n(End of file - total 1 lines)\n\n<system-reminder>\nProject instructions\n</system-reminder>",
      },
    },
    {
      name: "a read missing its path",
      tool: "read",
      input: { filePath: "/workspace/src" },
      output: missingPath,
      expected: { type: "dynamic_tool", output: missingPath },
    },
    {
      name: "a read missing its closing tag",
      tool: "read",
      input: { filePath: "/workspace/src/env.ts" },
      output: missingClose,
      expected: { type: "dynamic_tool", output: missingClose },
    },
    {
      name: "another tool's read envelope",
      tool: "custom_read",
      input: { filePath: "/workspace/src" },
      output: directory,
      expected: { type: "dynamic_tool", title: "custom_read", output: directory },
    },
    {
      name: "a grep",
      tool: "grep",
      input: { pattern: "TODO", path: "apps/web" },
      output: "---\nfile body",
      expected: {
        type: "file_search",
        title: "Searched TODO in web",
        pattern: "TODO",
        results: [{ fileName: "apps/web", preview: "---\nfile body" }],
      },
    },
    {
      name: "a glob without matches",
      tool: "glob",
      input: { pattern: "missing", path: "apps/web" },
      output: "",
      expected: { type: "file_search", pattern: "missing" },
      absent: "results",
    },
    {
      name: "a web search",
      tool: "websearch",
      input: { query: "OpenCode documentation" },
      output: "---\nfile body",
      expected: {
        type: "web_search",
        patterns: ["OpenCode documentation"],
        results: [{ snippet: "---\nfile body" }],
      },
    },
    {
      name: "a code search without a query or output",
      tool: "codesearch",
      input: {},
      output: " \n\t",
      expected: { type: "web_search" },
      absent: "results",
    },
    {
      name: "a patch",
      tool: "apply_patch",
      input: { filePath: "local.ts" },
      output: "done",
      expected: { type: "file_change", fileName: "local.ts" },
    },
  ])("projects $name", ({ tool, input, output, expected, absent }) => {
    const item = openCodeToolTurnItem(base(tool), {
      name: tool,
      input,
      output,
      completedMetadata: {},
    });
    expect(item).toMatchObject(expected);
    if (absent !== undefined) expect(item).not.toHaveProperty(absent);
  });
});
