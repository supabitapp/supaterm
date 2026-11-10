import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { clickOnFakeClock, pressAgain } from "~/test/inlineConfirm";
import { act, fakeTimers, render as renderUi, type Screen } from "../../../test/render";
import {
  PullRequestApproveWorkflowsButton,
  PullRequestPrimaryAction,
} from "./PullRequestDetailActions";

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

describe("PullRequestPrimaryAction", () => {
  it.each(["merge", "enable-auto-merge"] as const)(
    "keeps a blocked %s action reachable without arming or performing it",
    async (primaryAction) => {
      const performAction = vi.fn(async () => true);
      const control = (mergeBlockedReason: string | null) => (
        <PullRequestPrimaryAction
          pullRequestNumber={7}
          baseBranch="main"
          primaryAction={primaryAction}
          mergeBlockedReason={mergeBlockedReason}
          autoMergeArmed={false}
          canDisableAutoMerge={false}
          armedAutoMergeLabel="Auto-merge enabled"
          pendingAutoMergeLabel="Auto-merge (squash)"
          selectedMergeMethod="squash"
          selectedMergeMethodLabel="Squash and merge"
          statePresentation={null}
          pendingAction={null}
          perform={performAction}
          resolveConflicts={null}
        />
      );
      await using blocked = await renderUi(control("Checking stack membership…"));
      const target = blocked.getByRole("button");
      await userEvent.tab();
      await expect.element(target).toHaveFocus();
      await expect.element(target).toHaveAccessibleDescription("Checking stack membership…");
      await userEvent.keyboard("{Enter}{Enter} ");
      expect(performAction).not.toHaveBeenCalled();
      await blocked.rerender(control(null));
      await userEvent.click(target);
      expect(performAction).not.toHaveBeenCalled();
      await pressAgain(target.element());
      expect(performAction).toHaveBeenCalledExactlyOnceWith(primaryAction, "squash");
    },
  );
});
