import "~/index.css";
import {
  EnvironmentId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
vi.mock(import("./CommandOutputPanel"), () => ({
  useCommandOutputStreaming: () => true,
  CommandOutputPanel: () => <div>Command output stream</div>,
}));

import { render } from "../../../test/render";
import { PopoverCreateHandle } from "../ui/popover";
import type { BackgroundTaskOutputTarget } from "./BackgroundWork";
import { backgroundWorkNowItem } from "./ThreadActivityBanners";

it("opens each listed task from the background work line while a subagent reports progress", async () => {
  const audit = "python3 audit.py -j 6\n> scratch/audit.log 2>&1";
  const at = DateTime.makeUnsafe("2026-11-25T00:00:00.000Z");
  const inspectThreadId = ThreadId.make("inspect-thread");
  const onOpenThread = vi.fn();
  const item = backgroundWorkNowItem({
    environmentId: EnvironmentId.make("test"),
    threadId: ThreadId.make("thread"),
    projectId: ProjectId.make("project"),
    pullRequests: [],
    tasks: [
      {
        taskId: "serve",
        kind: "command",
        command: "bash -lc 'vp run dev'",
        description: "bash -lc 'vp run dev'",
      },
      { taskId: "audit", kind: "command", command: audit, description: "Audit", awaited: true },
      {
        taskId: "inspect",
        kind: "subagent",
        description: "Inspect",
        childThreadId: inspectThreadId,
      },
    ],
    turnItems: [
      {
        id: TurnItemId.make("inspect"),
        threadId: ThreadId.make("thread"),
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 0,
        status: "running",
        title: null,
        startedAt: at,
        completedAt: null,
        updatedAt: at,
        type: "subagent",
        subagentId: NodeId.make("inspect"),
        origin: "provider_native",
        driver: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        childThreadId: inspectThreadId,
        prompt: "Inspect the repository",
        progress: "Reading files",
        result: null,
      },
    ],
    outputHandle: PopoverCreateHandle<BackgroundTaskOutputTarget>(),
    stopDisabled: false,
    stopping: false,
    onStop: async () => {},
    onOpenThread,
  });
  await using screen = await render(
    <>
      {item?.description}
      {item?.actions}
    </>,
  );
  await expect.element(screen.getByRole("button", { name: "Details" })).not.toBeInTheDocument();
  expect(screen.container.textContent).toContain("Inspect: Reading files");
  await screen.getByRole("button", { name: "Open subagent Inspect" }).click();
  expect(onOpenThread).toHaveBeenCalledWith(inspectThreadId);
  await screen.getByRole("button", { name: "vp run dev" }).click();
  await expect
    .element(page.getByRole("dialog").getByText("Command", { exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Audit" }).click();
  const popup = page.getByRole("dialog", { name: "Output: Audit" });
  await vi.waitFor(() => expect(popup.element().textContent).toContain(audit));
  await expect.element(page.getByText("Command output stream")).toBeVisible();
  await expect.element(popup.getByText("Waiting", { exact: true })).toBeVisible();
});
