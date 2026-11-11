import "~/index.css";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
vi.mock(import("./CommandOutputPanel"), () => ({
  useCommandOutputStreaming: () => true,
  CommandOutputPanel: () => <div>Command output stream</div>,
}));

import { render } from "../../../test/render";
import { PopoverCreateHandle } from "../ui/popover";
import {
  BackgroundTaskOutputPopover,
  type BackgroundTaskOutputTarget,
  BackgroundWorkTitle,
} from "./BackgroundWork";

it("opens the full command behind a short title, with its output", async () => {
  const command = "python3 audit.py -j 6\n> scratch/audit.log 2>&1";
  const handle = PopoverCreateHandle<BackgroundTaskOutputTarget>();
  const view = (label: string) => (
    <>
      <BackgroundWorkTitle
        title={label}
        action={{
          kind: "output",
          handle,
          target: {
            environmentId: EnvironmentId.make("test"),
            threadId: ThreadId.make("thread"),
            taskId: "native-task",
            label,
            command,
          },
        }}
      />
      <BackgroundTaskOutputPopover handle={handle} />
    </>
  );
  await using screen = await render(view("Audit"));
  await screen.getByRole("button", { name: "Audit" }).click();
  const popup = page.getByRole("dialog", { name: "Output: Audit" });
  await vi.waitFor(() => expect(popup.element().textContent).toContain(command));
  await expect.element(page.getByText("Command output stream")).toBeVisible();
});
