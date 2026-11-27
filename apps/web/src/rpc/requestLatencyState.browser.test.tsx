import { WS_METHODS } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers } from "../../test/render";
import {
  acknowledgeRpcRequest,
  subscribeSlowRpcAckRequests,
  trackRpcRequestSent,
} from "./requestLatencyState";

describe("slow request warnings", () => {
  it("warns about a slow request but not a background report", async () => {
    using _clock = fakeTimers();
    let tags = "";
    const unsubscribe = subscribeSlowRpcAckRequests((requests) => {
      tags = requests.map((request) => request.tag).join(",");
    });
    const pending = [WS_METHODS.serverReportClientActivity, WS_METHODS.projectsListEntries];
    try {
      for (const method of pending) trackRpcRequestSent(method, method);
      await act(() => vi.advanceTimersByTime(15_000));
      await vi.waitFor(() => {
        expect(tags).toBe(WS_METHODS.projectsListEntries);
      });
    } finally {
      await act(() => {
        for (const method of pending) acknowledgeRpcRequest(method);
      });
      unsubscribe();
    }
  });
});
