import { expect, it } from "vite-plus/test";

import {
  compactionBlocksSteering,
  composerRunsDraftLocally,
  outboxDispatchMode,
} from "./composerDispatch.ts";

it.each([
  { dispatchMode: "steer", setupRunning: true, deferredSteering: true, expected: "steer" },
  { dispatchMode: "steer", setupRunning: true, deferredSteering: false, expected: "queue" },
  { dispatchMode: "queue", setupRunning: true, deferredSteering: true, expected: "queue" },
  { dispatchMode: "auto", setupRunning: true, deferredSteering: true, expected: "queue" },
  { dispatchMode: "restart", setupRunning: true, deferredSteering: true, expected: "queue" },
  { dispatchMode: "steer", setupRunning: false, deferredSteering: true, expected: "auto" },
  { dispatchMode: "queue", setupRunning: false, deferredSteering: true, expected: "queue" },
  { dispatchMode: "restart", setupRunning: false, deferredSteering: false, expected: "restart" },
] as const)(
  "sends $dispatchMode during setup $setupRunning with deferredSteering $deferredSteering as $expected",
  ({ expected, ...input }) => {
    expect(outboxDispatchMode(input)).toBe(expected);
  },
);

it("blocks steering for explicit compaction, and for automatic compaction unless the provider takes steers then", () => {
  const during = (
    text: string | undefined,
    attachments: ReadonlyArray<unknown> = [],
    steersDuringCompaction = true,
  ) =>
    compactionBlocksSteering({
      compactCommandIsActive: false,
      compactionRunning: true,
      steersDuringCompaction,
      run: { userMessageId: "user" },
      messages: [
        ...(text === undefined ? [] : [{ id: "user", text, attachments }]),
        { id: "later", text: "/compact" },
      ],
    });

  for (const text of ["/compact", "  /COMPACT  ", "/compact keep the debugging notes"]) {
    expect(during(text)).toBe(true);
  }
  for (const text of ["Read the code", "/compactify", "please /compact", undefined]) {
    expect(during(text)).toBe(false);
  }
  expect(during("/compact", [{}])).toBe(false);
  expect(during("Read the code", [], false)).toBe(true);

  expect(
    compactionBlocksSteering({
      compactCommandIsActive: true,
      compactionRunning: false,
      steersDuringCompaction: true,
      run: undefined,
      messages: undefined,
    }),
  ).toBe(true);
  expect(
    compactionBlocksSteering({
      compactCommandIsActive: false,
      compactionRunning: false,
      steersDuringCompaction: false,
      run: { userMessageId: "user" },
      messages: [{ id: "user", text: "/compact" }],
    }),
  ).toBe(false);
});

it("treats only the commands the composer runs itself as local", () => {
  const none = {
    holdsOnlyText: true,
    sideChat: false,
    usageLimits: false,
    codexFeedback: false,
    freshSession: false,
  };
  const all = {
    ...none,
    sideChat: true,
    usageLimits: true,
    codexFeedback: true,
    freshSession: true,
  };
  for (const text of ["/btw why?", "/usage-limits", "/feedback slow", "/clear"]) {
    expect(composerRunsDraftLocally({ ...all, text })).toBe(true);
    expect(composerRunsDraftLocally({ ...none, text })).toBe(false);
  }
  expect(composerRunsDraftLocally({ ...all, text: "fix the bug" })).toBe(false);
  expect(composerRunsDraftLocally({ ...all, holdsOnlyText: false, text: "/clear" })).toBe(false);
  expect(composerRunsDraftLocally({ ...all, holdsOnlyText: false, text: "/side why?" })).toBe(true);
});
