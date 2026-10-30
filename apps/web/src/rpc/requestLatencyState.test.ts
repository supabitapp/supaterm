import { ORCHESTRATION_V2_WS_METHODS } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  acknowledgeRpcRequest,
  subscribeSlowRpcAckRequests,
  trackRpcRequestSent,
} from "./requestLatencyState";

describe("slow request warnings", () => {
  it("leaves out a next-prompt suggestion that is still pending after 15 seconds", () => {
    vi.useFakeTimers();
    const pending = [
      ["dispatch", ORCHESTRATION_V2_WS_METHODS.dispatchCommand],
      ["suggestion", ORCHESTRATION_V2_WS_METHODS.suggestNextPrompt],
    ] as const;
    let slowTags: ReadonlyArray<string> = [];
    const unsubscribe = subscribeSlowRpcAckRequests((requests) => {
      slowTags = requests.map((request) => request.tag);
    });
    try {
      for (const [requestId, method] of pending) trackRpcRequestSent(requestId, method, requestId);
      vi.advanceTimersByTime(15_000);
      expect(slowTags).toEqual(["dispatch"]);
    } finally {
      for (const [requestId] of pending) acknowledgeRpcRequest(requestId);
      unsubscribe();
      vi.useRealTimers();
    }
  });
});
