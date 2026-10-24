import {
  DictationAuthError,
  DictationClipError,
  DictationRateLimitedError,
  DictationSourceId,
  DictationUnavailableError,
  DictationUpstreamError,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  classifyDictationFailure,
  DictationClipFailure,
  dictationLanguage,
} from "./dictationFailure.ts";

const SOURCE = DictationSourceId.make("claude:work");

describe("classifyDictationFailure", () => {
  it.each([
    [new DictationRateLimitedError({ retryAfterSeconds: 30 }), "transient"],
    [new DictationUpstreamError({ category: "network", status: null }), "transient"],
    [new DictationUpstreamError({ category: "bad-response", status: 200 }), "terminal"],
    [new DictationClipError({ problem: "missing" }), "transient"],
    [new DictationClipError({ problem: "too-short" }), "empty"],
    [new DictationClipError({ problem: "unsupported-format" }), "terminal"],
    [new DictationAuthError({ sourceId: SOURCE }), "terminal"],
    [new DictationUnavailableError({ reason: "source-ineligible" }), "terminal"],
    [{ _tag: "RpcClientError", message: "socket closed" }, "transient"],
    [new Error("boom"), "terminal"],
  ] as const)("classifies %o as %s", (error, kind) => {
    expect(classifyDictationFailure(error).kind).toBe(kind);
  });

  it("keeps an already classified failure", () => {
    const failure = new DictationClipFailure("cancelled", "Transcription was cancelled.");
    expect(classifyDictationFailure(failure)).toBe(failure);
  });
});

describe("dictationLanguage", () => {
  it.each([
    ["en-US", "en"],
    ["pt_BR", "pt"],
    ["zh-Hant-TW", "zh"],
    ["", null],
    [null, null],
  ] as const)("reads %o as %o", (locale, language) => {
    expect(dictationLanguage(locale)).toBe(language);
  });
});
