import { describe, expect, it, vi } from "vite-plus/test";

import { subscribeDocumentReturn } from "./documentActivity";

describe("subscribeDocumentReturn", () => {
  it("fires on every window focus and every return to a visible tab", () => {
    const view = new EventTarget();
    const visibility: { visibilityState: DocumentVisibilityState } = { visibilityState: "visible" };
    const page = Object.assign(new EventTarget(), visibility);
    const wake = vi.fn();
    using subscription = new DisposableStack();
    subscription.defer(subscribeDocumentReturn(wake, { window: view, document: page }));

    view.dispatchEvent(new Event("focus"));
    view.dispatchEvent(new Event("focus"));
    expect(wake).toHaveBeenCalledTimes(2);

    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(wake).toHaveBeenCalledTimes(2);
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(wake).toHaveBeenCalledTimes(3);

    subscription.dispose();
    view.dispatchEvent(new Event("focus"));
    expect(wake).toHaveBeenCalledTimes(3);
  });
});
