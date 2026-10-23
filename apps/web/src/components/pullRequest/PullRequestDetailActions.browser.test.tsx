import { describe, expect, it, vi } from "vite-plus/test";

import { clickOnFakeClock } from "~/test/inlineConfirm";
import { act, fakeTimers, render as renderUi, type Screen } from "../../../test/render";
import { PullRequestApproveWorkflowsButton } from "./PullRequestDetailActions";

let screen: Screen;
const perform = vi.fn(async () => true);

const button = () => screen.container.querySelector("button")!;
const press = () => act(() => clickOnFakeClock(button()));

async function setupTest() {
  await using resources = new AsyncDisposableStack();
  resources.defer(() => {
    perform.mockClear();
  });

  resources.use(fakeTimers({ now: 0 }));
  screen = resources.use(await renderUi(null, { router: false }));
  await screen.rerender(
    <PullRequestApproveWorkflowsButton
      pullRequestNumber={42}
      workflowApprovalsRequired={2}
      pendingAction={null}
      perform={perform}
    />,
  );

  return resources.move();
}

describe("PullRequestApproveWorkflowsButton", () => {
  it("shows that it is armed after the first press and approves on the second", async () => {
    await using _test = await setupTest();
    expect(button().getAttribute("aria-label")).toBe("Approve workflows to run");
    await press();
    expect(perform).not.toHaveBeenCalled();
    expect(button().getAttribute("aria-label")).toBe("Confirm approval");
    await act(() => vi.advanceTimersByTime(500));
    await press();
    expect(perform).toHaveBeenCalledExactlyOnceWith("approve-workflows");
    expect(button().getAttribute("aria-label")).toBe("Approve workflows to run");
  });
});
