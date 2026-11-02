import {
  SecretRequestAnswerInput,
  SecretRequestError,
  ThreadId,
  TurnItemId,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  secretRequestAnswerInput,
  secretRequestDisplay,
  secretRequestFailureMessage,
} from "./secretRequest.ts";

const decodeAnswer = Schema.decodeUnknownSync(SecretRequestAnswerInput);
const encodeAnswer = Schema.encodeSync(SecretRequestAnswerInput);

describe("secretRequestDisplay", () => {
  it("never offers the form for a request inherited from another thread", () => {
    expect(secretRequestDisplay({ secretStatus: "pending" }, "inherited")).toEqual({
      kind: "pending-elsewhere",
      label: "Waiting for an answer in the original thread",
    });
    expect(secretRequestDisplay({ secretStatus: "saved" }, "inherited")).toMatchObject({
      outcome: "saved",
    });
  });
});

describe("secretRequestAnswerInput", () => {
  it("keeps surrounding whitespace through the contract and refuses blank values", () => {
    const item = { threadId: ThreadId.make("thread-1"), id: TurnItemId.make("request-1") };
    const input = secretRequestAnswerInput(item, { type: "save", secret: "  a b λ  " });
    if (input === null) throw new Error("A nonblank secret must be accepted.");
    expect(input.answer).toEqual({ type: "save", secret: "  a b λ  " });
    expect(decodeAnswer(encodeAnswer(input))).toEqual(input);
    expect(secretRequestAnswerInput(item, { type: "save", secret: " \n " })).toBeNull();
    expect(() =>
      decodeAnswer({
        threadId: item.threadId,
        turnItemId: item.id,
        answer: { type: "save", secret: "\t\r\n" },
      }),
    ).toThrow();
  });
});

describe("secretRequestFailureMessage", () => {
  it("passes through server errors but hides anything that could echo the payload", () => {
    expect(
      secretRequestFailureMessage(new SecretRequestError({ reason: "already_answered" })),
    ).toBe("This secret request was already answered.");
    expect(secretRequestFailureMessage(new Error('Expected string, got "whsec_1"'))).toBe(
      "Could not answer the request. Try again.",
    );
    expect(secretRequestFailureMessage(undefined)).toBe("Could not answer the request. Try again.");
  });
});
