import "~/index.css";
import { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
vi.mock(import("./CommandOutputPanel"), () => ({
  useCommandOutputStreaming: () => true,
  CommandOutputPanel: () => <div>Command output stream</div>,
}));

import { render } from "../../../test/render";
import { PopoverCreateHandle } from "../ui/popover";
import type { BackgroundTaskOutputTarget } from "./BackgroundWork";
import { backgroundWorkBannerItem } from "./ThreadActivityBanners";

it("opens each listed command's full text and output from the banner", async () => {
  const audit = "python3 audit.py -j 6\n> scratch/audit.log 2>&1";
  const item = backgroundWorkBannerItem({
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
    ],
    outputHandle: PopoverCreateHandle<BackgroundTaskOutputTarget>(),
    stopDisabled: false,
    stopping: false,
    onStop: async () => {},
    onOpenThread: () => {},
  });
  await using screen = await render(
    <>
      {item?.description}
      {item?.actions}
    </>,
  );
  await expect.element(screen.getByRole("button", { name: "Details" })).not.toBeInTheDocument();
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
