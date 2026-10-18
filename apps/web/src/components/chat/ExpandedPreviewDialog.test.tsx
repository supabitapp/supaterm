// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { ExpandedPreviewDialog, ExpandedPreviewHostContext } from "./ExpandedPreviewDialog";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("keeps its host from recycling it while open", async () => {
  const reportOpen = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() =>
    root.render(
      <ExpandedPreviewHostContext value={reportOpen}>
        <ExpandedPreviewDialog title="Diagram" fit="center" onClose={() => {}}>
          <pre>diagram</pre>
        </ExpandedPreviewDialog>
      </ExpandedPreviewHostContext>,
    ),
  );
  expect(reportOpen).toHaveBeenLastCalledWith(true);
  await act(() => root.unmount());
  expect(reportOpen).toHaveBeenLastCalledWith(false);
  container.remove();
});
