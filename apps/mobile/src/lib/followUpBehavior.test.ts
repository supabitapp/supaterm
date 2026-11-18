import { describe, expect, it } from "vite-plus/test";

import { outboxFollowUpDispatchMode } from "./followUpBehavior";

describe("outboxFollowUpDispatchMode", () => {
  it.each([
    { followUpAction: "steer", setupRunning: true, deferredSteering: true, expected: "steer" },
    { followUpAction: "steer", setupRunning: true, deferredSteering: false, expected: "queue" },
    { followUpAction: "queue", setupRunning: true, deferredSteering: true, expected: "queue" },
    { followUpAction: "auto", setupRunning: true, deferredSteering: true, expected: "queue" },
    { followUpAction: "steer", setupRunning: false, deferredSteering: true, expected: "auto" },
    { followUpAction: "queue", setupRunning: false, deferredSteering: true, expected: "queue" },
    { followUpAction: "auto", setupRunning: false, deferredSteering: true, expected: null },
  ] as const)(
    "sends $followUpAction during setup $setupRunning with deferredSteering $deferredSteering as $expected",
    ({ expected, ...input }) => {
      expect(outboxFollowUpDispatchMode(input)).toBe(expected);
    },
  );
});
