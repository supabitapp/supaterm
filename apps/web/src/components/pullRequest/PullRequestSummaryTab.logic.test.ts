import { expect, it } from "vite-plus/test";

import { stepPullRequestEdit, type PullRequestEditState } from "./PullRequestSummaryTab.logic";

it("lets a settled save move only the editor that started it", () => {
  const others: ReadonlyArray<PullRequestEditState> = [
    { kind: "viewing" },
    { kind: "editing", target: "other" },
    { kind: "saving", target: "other" },
  ];
  for (const state of others) {
    expect(stepPullRequestEdit(state, { kind: "saved", target: "comment" })).toBe(state);
    expect(stepPullRequestEdit(state, { kind: "failed", target: "comment" })).toBe(state);
  }
});
