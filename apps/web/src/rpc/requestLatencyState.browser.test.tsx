import { ORCHESTRATION_V2_WS_METHODS } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers } from "../../test/render";
import {
  acknowledgeRpcRequest,
  subscribeSlowRpcAckRequests,
  trackRpcRequestSent,
} from "./requestLatencyState";

describe("slow request warnings", () => {
  it("leaves out a next-prompt suggestion that is still pending after 15 seconds", async () => {
    using _clock = fakeTimers();
    let tags = "";
    const unsubscribe = subscribeSlowRpcAckRequests((requests) => {
      tags = requests.map((request) => request.tag).join(",");
    });
    const pending = [
      ["dispatch", ORCHESTRATION_V2_WS_METHODS.dispatchCommand],
      ["suggestion", ORCHESTRATION_V2_WS_METHODS.suggestNextPrompt],
    ] as const;
    try {
      for (const [requestId, method] of pending) trackRpcRequestSent(requestId, method, requestId);
      await act(() => vi.advanceTimersByTime(15_000));
      await vi.waitFor(() => {
        expect(tags).toBe("dispatch");
      });
    } finally {
      await act(() => {
        for (const [requestId] of pending) acknowledgeRpcRequest(requestId);
      });
      unsubscribe();
    }
  });
});
