import { vi } from "vite-plus/test";

/**
 * Browser tests run without the app stylesheet, so a diagram's flex container would measure 0 px.
 * Elements get a desktop width, except inside a `hidden` subtree, which real layout leaves at 0.
 */
export function stubDiagramGeometry() {
  return vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.closest("[hidden]") ? 0 : 640;
  });
}
