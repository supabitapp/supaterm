import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { usePaneScope } from "../../chatPanes/paneScope";
import { useChatPaneStore } from "../../chatPanes/store";
import { RightPanelSheet } from "../RightPanelSheet";
import { ChatPaneWorkspace } from "./ChatPaneWorkspace";

vi.mock("../ThreadRouteView", () => ({
  ThreadRouteView: () => <PaneSheet />,
}));

function PaneSheet() {
  const scope = usePaneScope();
  return (
    <RightPanelSheet animationDurationMs={0} open onClose={() => {}} container={scope?.element}>
      <p>Right panel content</p>
    </RightPanelSheet>
  );
}

const target = {
  kind: "server" as const,
  threadRef: { environmentId: "env" as EnvironmentId, threadId: "thread" as ThreadId },
};

describe("ChatPaneWorkspace", () => {
  it("shows a pane's right panel sheet when the pane is not split", async () => {
    using _store = {
      [Symbol.dispose]: () =>
        useChatPaneStore.setState({ layout: null, closed: [], openToSide: null }),
    };
    await using _screen = await render(<ChatPaneWorkspace target={target} />);

    await expect.element(page.getByText("Right panel content")).toBeVisible();
  });
});
