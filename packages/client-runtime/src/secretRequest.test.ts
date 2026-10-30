import { SecretRequestError, ThreadId, TurnItemId } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { SecretRequestAnswerInput } from "../../contracts/src/secretRequest.ts";
import {
  secretRequestAnswerInput,
  secretRequestDisplay,
  secretRequestFailureMessage,
  secretRequestPrivacyNote,
} from "./secretRequest.ts";

const decodeAnswer = Schema.decodeSync(SecretRequestAnswerInput);

const item = { threadId: ThreadId.make("thread-1"), id: TurnItemId.make("request-1") };

describe("private request display", () => {
  it("only offers a pending form in its original thread", () => {
    expect(secretRequestDisplay({ secretStatus: "pending" }, "local")).toEqual({ kind: "pending" });
    for (const visibility of ["inherited", "synthetic"] as const) {
      expect(secretRequestDisplay({ secretStatus: "pending" }, visibility)).toEqual({
        kind: "pending-elsewhere",
        label: "Waiting for an answer in the original thread",
      });
    }
    for (const secretStatus of ["saved", "declined", "cancelled"] as const) {
      expect(secretRequestDisplay({ secretStatus }, "local").kind).toBe("answered");
    }
  });

  it("discloses plaintext storage, shell access, and cleanup without promising agent secrecy", () => {
    const note = secretRequestPrivacyNote({ delivery: "file" });
    expect(note).toContain("plaintext");
    expect(note).toContain("read or print");
    expect(note).toContain("after 24 hours without file changes");
    expect(note).not.toContain("never shown");
  });
});

describe("private answers", () => {
  it("trims a value, refuses blank input, and preserves the target thread", () => {
    expect(
      secretRequestAnswerInput(item, { type: "save", secret: "  disposable-token  " }),
    ).toEqual({
      threadId: item.threadId,
      turnItemId: item.id,
      answer: { type: "save", secret: "disposable-token" },
    });
    expect(secretRequestAnswerInput(item, { type: "save", secret: " \n " })).toBeNull();
    expect(secretRequestAnswerInput(item, { type: "decline" })).toEqual({
      threadId: item.threadId,
      turnItemId: item.id,
      answer: { type: "decline" },
    });
  });

  it("rejects a blank value at the contract boundary", () => {
    expect(() =>
      decodeAnswer({
        threadId: item.threadId,
        turnItemId: item.id,
        answer: { type: "save", secret: "  " },
      }),
    ).toThrow();
  });
});

describe("private request failure messages", () => {
  it("uses fixed reason messages and never trusts a payload-bearing message or cause", () => {
    expect(
      secretRequestFailureMessage(new SecretRequestError({ reason: "already_answered" })),
    ).toBe("This secret request was already answered.");
    const secret = "do-not-echo-this-value";
    for (const error of [
      new Error(`Expected a string: ${secret}`),
      { _tag: "SecretRequestError", reason: "already_answered", message: secret, cause: secret },
      { _tag: "SecretRequestError", reason: "unrecognized", message: secret },
      { _tag: "EnvironmentAuthorizationError", message: secret },
      undefined,
    ]) {
      expect(secretRequestFailureMessage(error)).not.toContain(secret);
    }
  });
});
