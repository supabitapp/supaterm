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
const encodeAnswer = Schema.encodeSync(SecretRequestAnswerInput);

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
  it("preserves surrounding whitespace, refuses blank input, and keeps the target thread", () => {
    expect(secretRequestAnswerInput(item, { type: "save", secret: "  a b λ  " })).toEqual({
      threadId: item.threadId,
      turnItemId: item.id,
      answer: { type: "save", secret: "  a b λ  " },
    });
    expect(secretRequestAnswerInput(item, { type: "save", secret: " \n " })).toBeNull();
    expect(secretRequestAnswerInput(item, { type: "decline" })).toEqual({
      threadId: item.threadId,
      turnItemId: item.id,
      answer: { type: "decline" },
    });
  });

  it("preserves opaque secret bytes when encoding and decoding the contract", () => {
    const input = {
      threadId: item.threadId,
      turnItemId: item.id,
      answer: { type: "save" as const, secret: "  a b λ  " },
    };
    expect(encodeAnswer(input)).toEqual(input);
    expect(decodeAnswer(input)).toEqual(input);
  });

  it("rejects a blank value at the contract boundary", () => {
    for (const secret of ["", "  ", "\t\r\n"]) {
      const input = {
        threadId: item.threadId,
        turnItemId: item.id,
        answer: { type: "save" as const, secret },
      };
      expect(() => decodeAnswer(input)).toThrow();
      expect(() => encodeAnswer(input)).toThrow();
    }
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
