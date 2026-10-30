import { ORCHESTRATION_V2_WS_METHODS } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import { AppAtomRegistryProvider } from "./atomRegistry";
import {
  acknowledgeRpcRequest,
  trackRpcRequestSent,
  useSlowRpcAckRequests,
} from "./requestLatencyState";

function SlowRequestTags() {
  const requests = useSlowRpcAckRequests();
  return <output>{requests.map((request) => request.tag).join(",")}</output>;
}

describe("slow request warnings", () => {
  it("leaves out a next-prompt suggestion that is still pending after 15 seconds", async () => {
    using _clock = fakeTimers();
    await using screen = await render(
      <AppAtomRegistryProvider>
        <SlowRequestTags />
      </AppAtomRegistryProvider>,
      { router: false },
    );
    const pending = [
      ["dispatch", ORCHESTRATION_V2_WS_METHODS.dispatchCommand],
      ["suggestion", ORCHESTRATION_V2_WS_METHODS.suggestNextPrompt],
    ] as const;
    try {
      for (const [requestId, method] of pending) trackRpcRequestSent(requestId, method, requestId);
      await act(() => vi.advanceTimersByTime(15_000));
      await expect.element(screen.getByRole("status")).toHaveTextContent(/^dispatch$/);
    } finally {
      await act(() => {
        for (const [requestId] of pending) acknowledgeRpcRequest(requestId);
      });
    }
  });
});
