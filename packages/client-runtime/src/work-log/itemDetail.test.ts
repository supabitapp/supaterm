import {
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
  type OrchestrationV2ProjectedTurnItem,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { toolGroupImages } from "./presentation.js";
import { turnItemOutputImages, turnItemOutputText } from "./itemDetail.ts";

const screenshot = {
  id: TurnItemId.make("tool-screenshot"),
  type: "dynamic_tool" as const,
  threadId: ThreadId.make("thread-1"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "completed" as const,
  title: null,
  toolName: "mcp__supaterm__device_screenshot",
  input: { deviceId: "phone" },
  output: {
    content: [
      { type: "text", text: "Captured the home screen." },
      { type: "image", mimeType: "image/png" },
    ],
  },
  startedAt: DateTime.makeUnsafe("2026-10-05T00:00:00.000Z"),
  completedAt: DateTime.makeUnsafe("2026-10-05T00:00:01.000Z"),
  updatedAt: DateTime.makeUnsafe("2026-10-05T00:00:01.000Z"),
};

function projectedScreenshot(
  fields: Partial<Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>> = {},
): OrchestrationV2ProjectedTurnItem {
  const item = { ...screenshot, ...fields };
  return {
    sourceThreadId: item.threadId,
    sourceItemId: item.id,
    position: item.ordinal,
    visibility: "local",
    item,
  };
}

describe("tool group images", () => {
  it("collects every image across the group's calls, newest first", () => {
    const first = projectedScreenshot({
      output: undefined,
      outputOmitted: true,
      outputImageCount: 2,
    });
    const text = projectedScreenshot({
      id: TurnItemId.make("text"),
      output: undefined,
      outputOmitted: true,
    });
    const running = { ...text, item: { ...text.item, status: "running" as const } };
    const newer = projectedScreenshot({
      id: TurnItemId.make("newer"),
      output: undefined,
      outputOmitted: true,
      outputImageCount: 1,
    });
    const image = (row: OrchestrationV2ProjectedTurnItem, index: number) => ({
      _tag: "tool-output-image",
      threadId: row.sourceThreadId,
      itemId: row.sourceItemId,
      index,
    });
    expect(toolGroupImages([first, text, running, newer]).map((entry) => entry.resource)).toEqual([
      image(newer, 0),
      image(first, 1),
      image(first, 0),
    ]);
    expect(toolGroupImages([text, running])).toEqual([]);
    expect(toolGroupImages([])).toEqual([]);
  });

  it("supports image metadata from older servers and viewed file paths", () => {
    const screenshotRow = projectedScreenshot();
    const file = projectedScreenshot({
      id: TurnItemId.make("file"),
      output: undefined,
      viewedImagePath: "screens/latest.png",
    });
    const reread = projectedScreenshot({
      id: TurnItemId.make("reread"),
      output: undefined,
      viewedImagePath: "screens/latest.png",
    });
    expect(
      toolGroupImages([file, reread], "/workspace").map((entry) => [entry.key, entry.resource]),
    ).toEqual([
      ["reread:viewed", expect.objectContaining({ path: "/workspace/screens/latest.png" })],
      ["file:viewed", expect.objectContaining({ path: "/workspace/screens/latest.png" })],
    ]);
    expect(
      toolGroupImages([screenshotRow, file], "/workspace").map((entry) => entry.resource),
    ).toEqual([
      { _tag: "media-file", threadId: file.sourceThreadId, path: "/workspace/screens/latest.png" },
      expect.objectContaining({ _tag: "tool-output-image", index: 0 }),
    ]);
  });
});

function toolItem(output: unknown): OrchestrationV2TurnItem {
  return {
    id: TurnItemId.make("images"),
    threadId: ThreadId.make("thread"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-10-01T00:00:00Z"),
    type: "dynamic_tool",
    toolName: "screenshots",
    input: {},
    output,
  };
}

describe("tool image output parsing", () => {
  it.each(["array", "content"] as const)(
    "keeps markers for images beyond the served positions in %s output",
    (shape) => {
      // Detail responses retain image metadata after the server strips image bytes.
      const image = { type: "image", mimeType: "image/png" };
      const blocks = Array.from({ length: 8 }, () => ({ ...image }));
      const wrap = (content: unknown[]) => (shape === "array" ? content : { content });
      const withinLimit = toolItem(wrap(blocks));
      expect(turnItemOutputText(withinLimit)).toBeNull();
      expect(turnItemOutputImages(withinLimit)).toHaveLength(8);

      const overflow = toolItem(
        wrap([
          ...blocks,
          { type: "text", text: "Two additional screenshots:" },
          { ...image, sizeBytes: 100 },
          { type: "image", source: { type: "base64", media_type: "image/jpeg" } },
        ]),
      );
      expect(turnItemOutputImages(overflow)).toHaveLength(8);
      expect(turnItemOutputText(overflow)).toBe("Two additional screenshots:\n[image]\n[image]");
    },
  );
});
