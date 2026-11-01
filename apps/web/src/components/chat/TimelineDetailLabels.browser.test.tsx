import {
  EnvironmentId,
  NodeId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";

import { fakeTimers, render } from "../../../test/render";
import { TimelineRowActivityCtx } from "./timelineRowContext";
import { WorkingTimelineRow } from "./TimelineWorkGroupRows";
import { V2ItemInspector } from "./V2ItemInspector";

it("counts how long compaction has been running", async () => {
  using _timers = fakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:12.000Z"));
  await using screen = await render(
    <TimelineRowActivityCtx
      value={{
        isWorking: true,
        isCompacting: true,
        compactionStartedAt: "2026-01-01T00:00:00.000Z",
        isRevertingCheckpoint: false,
        awaitingUser: false,
        isPreparingWorktree: false,
        latestRunId: null,
        backgroundWorktreeSetup: null,
      }}
    >
      <WorkingTimelineRow />
    </TimelineRowActivityCtx>,
  );

  expect(screen.container.textContent).toContain("Compacting for 12s");
});

it("lists each question's choices in the request inspector", async () => {
  const threadId = ThreadId.make("thread-1");
  const askedAt = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
  const projectedItem: OrchestrationV2ProjectedTurnItem = {
    position: 0,
    visibility: "local",
    sourceThreadId: threadId,
    sourceItemId: TurnItemId.make("question-item"),
    item: {
      id: TurnItemId.make("question-item"),
      threadId,
      runId: null,
      nodeId: NodeId.make("node-1"),
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: null,
      startedAt: askedAt,
      completedAt: askedAt,
      updatedAt: askedAt,
      type: "user_input_request",
      requestId: RuntimeRequestId.make("request-1"),
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "Which files?",
          options: [
            { label: "All", description: "Every file", value: "all" },
            { label: "Changed", description: "Only changed files", value: "changed" },
          ],
        },
      ],
    },
  };
  await using screen = await render(
    <V2ItemInspector
      projectedItem={projectedItem}
      environmentId={EnvironmentId.make("environment-1")}
    />,
  );

  await expect.element(screen.getByText(/Which files\?/)).toBeVisible();
  expect(screen.container.textContent).toContain("• All");
  expect(screen.container.textContent).toContain("• Changed");
});
