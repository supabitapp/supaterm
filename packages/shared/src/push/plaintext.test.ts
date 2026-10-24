import { describe, expect, it } from "vite-plus/test";

import {
  buildPushContent,
  padPushPlaintext,
  type PushContentSource,
  unpadPushPlaintext,
} from "./plaintext.ts";

const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).byteLength;
const source = (overrides: Partial<PushContentSource> = {}): PushContentSource => ({
  environmentId: "environment",
  threadId: "thread",
  kind: "approval",
  threadTitle: "Ship it",
  projectTitle: "supaterm",
  detail: "vp run deploy",
  ...overrides,
});

describe("buildPushContent", () => {
  it("reveals more of the thread at each preview level", () => {
    expect(buildPushContent(source(), "hidden")).toEqual({
      environmentId: "environment",
      threadId: "thread",
      kind: "approval",
      title: "Supaterm",
      body: "Approval needed",
    });
    expect(buildPushContent(source(), "titles")).toMatchObject({
      title: "Ship it",
      subtitle: "supaterm",
      body: "Approval needed",
    });
    expect(buildPushContent(source(), "full").body).toBe("Approval needed: vp run deploy");
    expect(buildPushContent(source({ detail: null }), "full").body).toBe("Approval needed");
  });

  it("falls back to the app name for an untitled thread and omits an empty project", () => {
    const content = buildPushContent(source({ threadTitle: " \n ", projectTitle: null }), "titles");
    expect(content.title).toBe("Supaterm");
    expect(content).not.toHaveProperty("subtitle");
  });

  it("strips control and bidi characters and collapses whitespace", () => {
    const content = buildPushContent(
      source({ threadTitle: "a\u0007b\u202Ec", detail: "line one\n\n\tline two\u0000" }),
      "full",
    );
    expect(content.title).toBe("abc");
    expect(content.body).toBe("Approval needed: line one line two");
  });

  it("truncates by bytes on code point boundaries", () => {
    const content = buildPushContent(
      source({ threadTitle: "🔐".repeat(100), projectTitle: "é".repeat(100) }),
      "titles",
    );
    expect(byteLength(content.title)).toBeLessThanOrEqual(120);
    expect(byteLength(content.subtitle ?? "")).toBeLessThanOrEqual(80);
    expect(content.title).not.toContain("�");
    expect(content.title.endsWith("🔐…")).toBe(true);
  });

  it("keeps escape-heavy content inside the largest size class", () => {
    const content = buildPushContent(
      source({
        threadTitle: '"'.repeat(200),
        projectTitle: "\\".repeat(200),
        detail: '"\\'.repeat(400),
      }),
      "full",
    );
    expect(byteLength(content.body)).toBeLessThanOrEqual(400);
    expect(padPushPlaintext(content).byteLength).toBe(1024);
  });
});

describe("push plaintext padding", () => {
  it("pads to the smallest size class and round-trips", () => {
    const content = buildPushContent(source(), "titles");
    const padded = padPushPlaintext(content);
    expect(padded.byteLength).toBe(256);
    expect(unpadPushPlaintext(padded)).toEqual(content);
  });

  it("rejects plaintext that is not exactly one size class", () => {
    const padded = padPushPlaintext(buildPushContent(source(), "titles"));
    expect(() => unpadPushPlaintext(padded.subarray(0, 255))).toThrow("size");
  });
});
