import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { PreviewEvent } from "./preview.ts";
import { PreviewAutomationHost, PreviewAutomationStatus } from "./previewAutomation.ts";

const decodePreviewEvent = Schema.decodeUnknownSync(PreviewEvent);
const decodeAutomationHost = Schema.decodeUnknownSync(PreviewAutomationHost);
const decodeAutomationStatus = Schema.decodeUnknownSync(PreviewAutomationStatus);

describe("PreviewAutomationHost", () => {
  it("requires an operation advertisement", () => {
    expect(() =>
      decodeAutomationHost({ clientId: "host", environmentId: "environment-1" }),
    ).toThrow();
    expect(
      decodeAutomationHost({
        clientId: "host",
        environmentId: "environment-1",
        supportedOperations: ["status", "resize"],
      }).supportedOperations,
    ).toEqual(["status", "resize"]);
  });
});

describe("PreviewAutomationStatus", () => {
  it("accepts old hosts without viewport data and exposes it from current hosts", () => {
    const base = {
      available: true,
      visible: false,
      tabId: "preview-t",
      url: "https://example.com",
      title: "Example",
      loading: false,
    };
    expect(decodeAutomationStatus(base)).toEqual(base);
    expect(
      decodeAutomationStatus({
        ...base,
        viewportSetting: { _tag: "preset", presetId: "pixel-7", width: 412, height: 915 },
        viewport: { width: 412, height: 915 },
      }).viewport,
    ).toEqual({ width: 412, height: 915 });
  });
});

describe("PreviewEvent", () => {
  it("decodes a backing change without navigation fields", () => {
    const event = decodePreviewEvent({
      type: "backingChanged",
      threadId: "t",
      tabId: "preview-t",
      createdAt: "2026-01-01T00:00:00.000Z",
      serverEpoch: "server-a",
      revision: 2,
      snapshot: {
        threadId: "t",
        tabId: "preview-t",
        navStatus: { _tag: "Idle" },
        canGoBack: false,
        canGoForward: false,
        browserBacking: "headless",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(event).toMatchObject({
      type: "backingChanged",
      snapshot: { browserBacking: "headless" },
    });
  });
});
