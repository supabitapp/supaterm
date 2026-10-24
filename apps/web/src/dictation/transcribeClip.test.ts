import { DictationSourceId, EnvironmentId } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  configs: new Map<string, unknown>(),
  upload: vi.fn(),
  deleted: vi.fn(),
  rpc: vi.fn(),
  convert: vi.fn(),
}));

vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: (atom: unknown) => (atom === "configs" ? harness.configs : null) },
}));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: "configs" }));
vi.mock("../state/attachments", () => ({
  attachmentEnvironment: { createUploadUrl: "create", remove: "remove" },
}));
vi.mock("../state/dictation", () => ({ dictationEnvironment: { transcribe: "transcribe" } }));
vi.mock("../state/session", () => ({
  readPreparedConnection: () => ({ httpBaseUrl: "https://env.test" }),
}));
vi.mock("./audioConversion", () => ({ convertRecordingToWav: harness.convert }));
vi.mock("@supaterm/client-runtime/state/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supaterm/client-runtime/state/attachments")>()),
  runAttachmentUploadCycle: harness.upload,
  deletePendingAttachmentUpload: harness.deleted,
}));
vi.mock("@supaterm/client-runtime/state/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supaterm/client-runtime/state/runtime")>()),
  runAtomCommand: harness.rpc,
}));

import {
  classifyDictationFailure,
  dictationClipFileName,
  dictationLanguage,
  transcribeDictationClip,
} from "./transcribeClip";

const ENV = EnvironmentId.make("env");
const SOURCE = DictationSourceId.make("codex:work");
const clip = {
  blob: new Blob(["opus"], { type: "audio/webm;codecs=opus" }),
  mimeType: "audio/webm;codecs=opus",
  durationMs: 300_040,
  locale: "en-US",
};

function transcribe(signal = new AbortController().signal) {
  return transcribeDictationClip({ environmentId: ENV, sourceId: SOURCE, clip, signal });
}

beforeEach(() => {
  harness.configs = new Map([
    [
      ENV,
      {
        dictation: { sources: [] },
        environment: {
          capabilities: {
            dictation: { maxClipBytes: 1024, maxDurationMs: 300_000 },
            fileAttachments: { maxUploadBytes: 50 * 1024 * 1024 },
          },
        },
      },
    ],
  ]);
  harness.upload.mockReset().mockResolvedValue({ status: "uploaded", attachmentId: "pending:a" });
  harness.deleted.mockReset();
  harness.convert.mockReset().mockResolvedValue(new Blob(["wav-audio"], { type: "audio/wav" }));
  harness.rpc
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ text: "Fix the cache.", sourceId: SOURCE }));
});

describe("transcribeDictationClip", () => {
  it("converts a Safari clip when the chosen source requires WAV", async () => {
    const config = harness.configs.get(ENV) as { dictation: unknown };
    config.dictation = { sources: [{ id: SOURCE, eligible: true, audioFormats: ["wav"] }] };
    await transcribeDictationClip({
      environmentId: ENV,
      sourceId: SOURCE,
      clip: { ...clip, mimeType: "audio/mp4" },
      signal: new AbortController().signal,
    });
    expect(harness.convert).toHaveBeenCalledWith(clip.blob);
    expect(harness.upload.mock.calls[0]?.[0].upload).toMatchObject({
      name: "dictation.wav",
      mimeType: "audio/wav",
      sizeBytes: 9,
    });
  });

  it("uploads the clip under a name that matches its format and transcribes it", async () => {
    await expect(transcribe()).resolves.toEqual({ text: "Fix the cache.", sourceId: SOURCE });
    expect(harness.upload.mock.calls[0]?.[0].upload).toEqual({
      type: "file",
      name: "dictation.webm",
      mimeType: "audio/webm;codecs=opus",
      sizeBytes: 4,
    });
    expect(harness.rpc.mock.calls[0]?.[2]).toEqual({
      environmentId: ENV,
      input: {
        attachmentId: "pending:a",
        sourceId: SOURCE,
        durationMs: 300_000,
        language: "en",
      },
    });
  });

  it("waits for a connection before uploading", async () => {
    harness.configs = new Map();
    await expect(transcribe()).rejects.toMatchObject({ kind: "transient" });
    expect(harness.upload).not.toHaveBeenCalled();
  });

  it("refuses clips over the environment's limits without uploading", async () => {
    harness.configs = new Map([
      [
        ENV,
        {
          dictation: { sources: [] },
          environment: {
            capabilities: {
              dictation: { maxClipBytes: 2, maxDurationMs: 300_000 },
              fileAttachments: { maxUploadBytes: 50 * 1024 * 1024 },
            },
          },
        },
      ],
    ]);
    await expect(transcribe()).rejects.toMatchObject({ kind: "terminal" });
    expect(harness.upload).not.toHaveBeenCalled();
  });

  it("reports silence as empty", async () => {
    harness.rpc.mockResolvedValue(AsyncResult.success({ text: "  ", sourceId: SOURCE }));
    await expect(transcribe()).rejects.toMatchObject({ kind: "empty" });
  });

  it("drops the upload and skips transcription once cancelled", async () => {
    const controller = new AbortController();
    harness.upload.mockImplementation(async () => {
      controller.abort();
      return { status: "uploaded", attachmentId: "pending:a" };
    });
    await expect(transcribe(controller.signal)).rejects.toMatchObject({ kind: "cancelled" });
    expect(harness.deleted).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentId: "pending:a" }),
    );
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("keeps the clip retryable when the environment is unreachable", async () => {
    harness.rpc.mockResolvedValue(
      AsyncResult.failure(Cause.fail({ _tag: "RpcClientError", message: "socket closed" })),
    );
    await expect(transcribe()).rejects.toMatchObject({ kind: "transient" });
  });
});

describe("dictation failures", () => {
  it.each([
    [{ _tag: "DictationRateLimitedError", retryAfterSeconds: 5 }, "transient"],
    [{ _tag: "DictationUpstreamError", category: "server", status: 503 }, "transient"],
    [{ _tag: "DictationUpstreamError", category: "bad-response", status: 200 }, "terminal"],
    [{ _tag: "DictationClipError", problem: "missing" }, "transient"],
    [{ _tag: "DictationClipError", problem: "too-short" }, "empty"],
    [{ _tag: "DictationClipError", problem: "unsupported-format" }, "terminal"],
    [{ _tag: "DictationAuthError", sourceId: "codex:work" }, "terminal"],
    [{ _tag: "DictationUnavailableError", reason: "endpoint-rejected" }, "terminal"],
    [{ _tag: "DictationUnavailableError", reason: "disabled" }, "terminal"],
    [{ _tag: "EnvironmentAuthorizationError" }, "terminal"],
    [{ _tag: "EnvironmentRpcUnavailableError" }, "transient"],
    [new Error("Unexpected"), "terminal"],
  ])("classifies %o as %s", (error, kind) => {
    expect(classifyDictationFailure(error).kind).toBe(kind);
  });

  it("names uploads by format and sends only the language", () => {
    expect(dictationClipFileName("audio/mp4;codecs=mp4a.40.2")).toBe("dictation.m4a");
    expect(dictationClipFileName("audio/ogg;codecs=opus")).toBe("dictation.ogg");
    expect(dictationClipFileName("audio/wav")).toBe("dictation.wav");
    expect(dictationClipFileName("audio/webm")).toBe("dictation.webm");
    expect(dictationLanguage("pt_BR")).toBe("pt");
    expect(dictationLanguage(null)).toBeNull();
  });
});
