import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { sideChatTurnNote } from "./SideChatNote.ts";

const at = (minute: number) =>
  DateTime.makeUnsafe(`2026-10-25T10:${String(minute).padStart(2, "0")}:00.000Z`);
const runs = [
  { ordinal: 1, requestedAt: at(1) },
  { ordinal: 2, requestedAt: at(2) },
  { ordinal: 3, requestedAt: at(5) },
  { ordinal: 4, requestedAt: at(6) },
];

it("sends the boundary on a side chat's first turn and a reminder after", () => {
  const thread = { sideChat: true };
  assert.include(sideChatTurnNote({ thread, runs, run: { ordinal: 1 } }), "reference context");
  assert.include(sideChatTurnNote({ thread, runs, run: { ordinal: 2 } }), "Still a side chat");
});

it("lifts the restrictions once, on the first turn after promotion", () => {
  const thread = { sideChat: false, sideChatPromotedAt: at(3) };
  assert.include(sideChatTurnNote({ thread, runs, run: { ordinal: 3 } }), "no longer a side chat");
  assert.equal(sideChatTurnNote({ thread, runs, run: { ordinal: 4 } }), "");
  assert.equal(
    sideChatTurnNote({
      thread: { sideChat: false, sideChatPromotedAt: at(0) },
      runs,
      run: { ordinal: 1 },
    }),
    "",
  );
});

it("adds nothing to ordinary threads", () => {
  assert.equal(sideChatTurnNote({ thread: {}, runs, run: { ordinal: 2 } }), "");
});
