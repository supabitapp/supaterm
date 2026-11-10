import "~/index.css";
import {
  EnvironmentId,
  type OrchestrationV2PendingBackgroundTask,
  ThreadId,
} from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
vi.mock(import("./CommandOutputPanel"), () => ({
  useCommandOutputStreaming: () => true,
  CommandOutputPanel: () => <div>Command output stream</div>,
}));

import { render } from "../../../test/render";
import { BackgroundWorkDetails } from "./BackgroundWorkDetails";

it("shows the full command behind a short label, its output, and a subagent's thread", async () => {
  const command = "python3 audit.py -j 6\n> scratch/audit.log 2>&1";
  const onOpenThread = vi.fn();
  const view = (task: OrchestrationV2PendingBackgroundTask) => (
    <BackgroundWorkDetails
      environmentId={EnvironmentId.make("test")}
      threadId={ThreadId.make("thread")}
      tasks={[task]}
      onOpenThread={onOpenThread}
    />
  );
  const commandTask = (description?: string): OrchestrationV2PendingBackgroundTask => ({
    taskId: "native-task",
    kind: "command",
    command,
    awaited: true,
    ...(description === undefined ? {} : { description }),
  });
  await using screen = await render(view(commandTask("Audit")));
  await screen.getByRole("button", { name: "Details", exact: true }).click();
  await vi.waitFor(() => expect(page.getByRole("dialog").element().textContent).toContain(command));
  await expect.element(page.getByRole("heading", { name: "Audit" })).toBeVisible();
  await expect.element(page.getByText("Command output stream")).toBeVisible();

  await screen.rerender(view(commandTask(command)));
  await expect.element(page.getByRole("heading", { name: "Command", exact: true })).toBeVisible();
  await screen.rerender(view(commandTask()));
  await expect.element(page.getByRole("heading", { name: "Command", exact: true })).toBeVisible();

  const child = ThreadId.make("child");
  await screen.rerender(
    view({ taskId: "agent", kind: "subagent", description: "Review", childThreadId: child }),
  );
  await expect.element(page.getByText("Command output stream")).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Open thread" }).click();
  expect(onOpenThread).toHaveBeenCalledWith(child);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});
