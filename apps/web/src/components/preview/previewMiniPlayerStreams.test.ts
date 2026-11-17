import { expect, it } from "vite-plus/test";

import {
  forgetStream,
  recordStreamFrame,
  recordStreamViewport,
  selectPreviewMiniPlayerStream,
  usePreviewMiniPlayerStreams,
} from "./previewMiniPlayerStreams";

const stream = (key: string) =>
  selectPreviewMiniPlayerStream(usePreviewMiniPlayerStreams.getState(), key);

it("keeps each player's stream state while another player reports and ends", () => {
  usePreviewMiniPlayerStreams.setState(usePreviewMiniPlayerStreams.getInitialState(), true);
  recordStreamViewport("pane-a", { width: 800, height: 600 });
  recordStreamFrame("pane-a", "tab_a");
  recordStreamFrame("pane-b", "tab_b");
  recordStreamViewport("pane-b", { width: 400, height: 300 });

  expect(stream("pane-a")).toMatchObject({
    viewport: { width: 800, height: 600 },
    frameTabId: "tab_a",
  });
  expect(stream("pane-b")).toMatchObject({
    viewport: { width: 400, height: 300 },
    frameTabId: "tab_b",
  });

  forgetStream("pane-b");
  expect(stream("pane-b")).toBeNull();
  expect(stream("pane-a")).toMatchObject({ frameTabId: "tab_a" });
});
