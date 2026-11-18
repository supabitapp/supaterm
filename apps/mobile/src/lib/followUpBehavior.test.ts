import { describe, expect, it } from "vite-plus/test";

import { outboxFollowUpDispatchMode } from "./followUpBehavior";

describe("outboxFollowUpDispatchMode", () => {
  it.each([
    { followUpAction: "auto", setupRunning: true, deferredSteering: true, expected: "queue" },
    { followUpAction: "auto", setupRunning: false, deferredSteering: true, expected: null },
  ] as const)(
    "sends $followUpAction during setup $setupRunning with deferredSteering $deferredSteering as $expected",
    ({ expected, ...input }) => {
      expect(outboxFollowUpDispatchMode(input)).toBe(expected);
    },
  );
});
