import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import { useNowAfter } from "./useDeadline";

function Probe(props: { deadlineMs: number }) {
  const nowMs = useNowAfter(props.deadlineMs);
  return <output>{nowMs >= props.deadlineMs ? "passed" : "pending"}</output>;
}

describe("useNowAfter", () => {
  it("reads a fresh clock when a later deadline passes", async () => {
    using _timers = fakeTimers({ now: 0 });
    await using screen = await render(<Probe deadlineMs={1_000} />, {
      router: false,
    });
    await screen.rerender(<Probe deadlineMs={2_000} />);
    await expect.element(screen.getByText("pending")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTime(2_000));
    await expect.element(screen.getByText("passed")).toBeInTheDocument();
  });
});
