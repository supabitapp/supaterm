import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";

import { ExpandedPreviewDialog, ExpandedPreviewHostContext } from "./ExpandedPreviewDialog";

it("keeps its host from recycling it while open", async () => {
  const reportOpen = vi.fn();
  await using screen = await render(
    <ExpandedPreviewHostContext value={reportOpen}>
      <ExpandedPreviewDialog title="Diagram" fit="center" onClose={() => {}}>
        <pre>diagram</pre>
      </ExpandedPreviewDialog>
    </ExpandedPreviewHostContext>,
  );
  expect(reportOpen).toHaveBeenLastCalledWith(true);
  await screen.unmount();
  expect(reportOpen).toHaveBeenLastCalledWith(false);
});
