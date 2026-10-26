import type { ScopedThreadRef } from "@supaterm/contracts";
import { assert, describe, it } from "vite-plus/test";
import { shouldRenderThreadScopedToast } from "./toast.logic";

describe("shouldRenderThreadScopedToast", () => {
  const activeThreadRef = {
    environmentId: "environment-a",
    threadId: "thread-1",
  } as ScopedThreadRef;

  it("renders a toast scoped to the active thread ref", () => {
    assert.equal(
      shouldRenderThreadScopedToast(
        {
          threadRef: activeThreadRef,
        },
        [activeThreadRef],
      ),
      true,
    );
  });

  it("hides a scoped toast when the environment differs", () => {
    assert.equal(
      shouldRenderThreadScopedToast(
        {
          threadRef: {
            environmentId: "environment-b",
            threadId: "thread-1",
          } as ScopedThreadRef,
        },
        [activeThreadRef],
      ),
      false,
    );
  });

  it("renders a scoped toast for a thread shown in another pane", () => {
    assert.equal(
      shouldRenderThreadScopedToast({ threadRef: activeThreadRef }, [
        { environmentId: "environment-b", threadId: "thread-2" } as ScopedThreadRef,
        activeThreadRef,
      ]),
      true,
    );
  });

  it("keeps legacy thread-id scoped toasts working", () => {
    assert.equal(
      shouldRenderThreadScopedToast(
        {
          threadId: "thread-1" as never,
        },
        [activeThreadRef],
      ),
      true,
    );
  });
});
