import { WS_METHODS } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import { AppAtomRegistryProvider } from "./atomRegistry";
import {
  acknowledgeRpcRequest,
  trackRpcRequestSent,
  useSlowRpcAckRequests,
} from "./requestLatencyState";

function SlowRequests() {
  return (
    <ul>
      {useSlowRpcAckRequests().map((request) => (
        <li key={request.requestId}>{request.tag}</li>
      ))}
    </ul>
  );
}

it("warns about slow cancellation but not transcription", async () => {
  using _timers = fakeTimers({ now: 0 });
  await using screen = await render(
    <AppAtomRegistryProvider>
      <SlowRequests />
    </AppAtomRegistryProvider>,
    { router: false },
  );

  const pending = [WS_METHODS.transcriptionTranscribe, WS_METHODS.transcriptionCancel];
  try {
    for (const method of pending) trackRpcRequestSent(method, method);
    await act(() => vi.advanceTimersByTime(15_000));
    await expect.element(screen.getByText("transcription.cancel", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByText("transcription.transcribe", { exact: true }))
      .not.toBeInTheDocument();
  } finally {
    await act(() => {
      for (const method of pending) acknowledgeRpcRequest(method);
    });
  }
});
