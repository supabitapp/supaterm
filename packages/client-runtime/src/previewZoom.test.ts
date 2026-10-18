import { expect, it } from "vite-plus/test";

import { PREVIEW_ZOOM, stepPreviewZoom } from "./previewZoom.ts";

it("steps preview zoom within its bounds", () => {
  expect(stepPreviewZoom(1, 1)).toBe(1.25);
  expect(stepPreviewZoom(1, -1)).toBe(0.75);
  expect(stepPreviewZoom(PREVIEW_ZOOM.max, 1)).toBe(PREVIEW_ZOOM.max);
  expect(stepPreviewZoom(PREVIEW_ZOOM.min, -1)).toBe(PREVIEW_ZOOM.min);
  expect(stepPreviewZoom(1.9, 1)).toBe(PREVIEW_ZOOM.max);
});
