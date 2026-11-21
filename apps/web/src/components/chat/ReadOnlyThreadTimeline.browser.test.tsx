import {
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { AsyncResult, Atom } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { makeThreadProjectionFixture } from "../../test-fixtures";
import { ReadOnlyThreadTimeline } from "./ReadOnlyThreadTimeline";

const NO_DETAIL = Atom.make(AsyncResult.initial());

describe("ReadOnlyThreadTimeline", () => {
  it("shows a created thread without a control that would open it", async () => {
    const projection = makeThreadProjectionFixture();
    const now = DateTime.makeUnsafe("2026-03-17T19:12:28.000Z");
    const item = {
      id: TurnItemId.make("item-thread-created"),
      threadId: projection.thread.id,
      runId: RunId.make("run-1"),
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: "Follow-up thread",
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      type: "thread_created",
      targetThreadId: ThreadId.make("thread-follow-up"),
      targetRunId: RunId.make("run-follow-up"),
      targetProviderInstanceId: ProviderInstanceId.make("codex"),
      targetModel: "gpt-5.4",
    } satisfies OrchestrationV2TurnItem;

    await using screen = await render(
      <div style={{ height: 800, width: 900, display: "flex", flexDirection: "column" }}>
        <ReadOnlyThreadTimeline
          threadKey="linked-thread-test"
          projection={{
            ...projection,
            turnItems: [item],
            visibleTurnItems: [
              {
                position: 0,
                visibility: "local",
                sourceThreadId: projection.thread.id,
                sourceItemId: item.id,
                item,
              },
            ],
          }}
          historyControls={undefined}
          turnItemSource={() => NO_DETAIL}
          onImageExpand={() => {}}
          renderHtmlRender={() => null}
        >
          {null}
        </ReadOnlyThreadTimeline>
      </div>,
    );

    await userEvent.click(screen.getByRole("button", { name: /^Worked for/ }));
    await expect.element(screen.getByText("Created thread")).toBeVisible();
    expect(screen.getByRole("button", { name: /^Open/ }).elements()).toHaveLength(0);
  });
});
