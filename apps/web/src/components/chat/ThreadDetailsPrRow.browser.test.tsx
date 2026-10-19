import {
  EnvironmentId,
  GitCommandError,
  GitManagerError,
  ProjectId,
  ThreadId,
  type PullRequestCheck,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { DraftId } from "~/composerDraftStore";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  status: "success" as PullRequestCheck["status"],
  extraStatus: null as PullRequestCheck["status"] | null,
  perform: vi.fn(),
  newThread: vi.fn(),
  prepareThread: vi.fn(),
  checkoutError: null as Error | null,
  addToast: vi.fn(),
  updateToast: vi.fn(),
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useServerConfigs: (() => new Map()) as never,
}));
const queryData = () => ({
  projectId: ProjectId.make("project"),
  workspaceRoot: "/workspace",
  url: "https://github.com/owner/repo/pull/1",
  number: 1,
  title: "Test PR",
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  headBranch: "feature",
  baseBranch: "main",
  changedFiles: 1,
  additions: 1,
  deletions: 0,
  checks: [state.status, ...(state.extraStatus ? [state.extraStatus] : [])].map((status) => ({
    name: `CI-${status}`,
    status,
    description: null,
    url: null,
  })),
  capabilities: { actions: ["merge"], mergeMethods: ["merge"] },
  viewerPermissions: { actions: ["merge"] },
  mergeCapabilities: { merge: true, squash: false, rebase: false },
});
vi.mock(import("~/state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuerySelector: ((_atom: unknown, select: (result: unknown) => unknown) =>
    select(AsyncResult.success(queryData()))) as never,
  useEnvironmentQueryIsNewer: () => true,
  useEnvironmentQueryRefresh: (() => ({ refresh: vi.fn(), isPending: () => false })) as never,
}));
vi.mock(import("../pullRequest/usePullRequestActions"), async (importOriginal) => ({
  ...(await importOriginal()),
  usePullRequestActionRunner: () => ({ actionPending: false, perform: state.perform }),
}));

import { clickAt } from "~/test/inlineConfirm";
vi.mock(import("~/hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => state.newThread) as never,
}));
vi.mock(import("~/lib/sourceControlActions"), async (original) => ({
  ...(await original()),
  usePreparePullRequestThreadAction: (() => ({
    run: state.prepareThread,
    isAllowed: true,
    error: state.checkoutError,
  })) as never,
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    toastManager: {
      ...actual.toastManager,
      add: state.addToast,
      update: state.updateToast,
    } as never,
  };
});

import { ThreadDetailsPrRow } from "./ThreadDetailsPrRow";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  state.checkoutError = null;
  state.newThread.mockReset().mockResolvedValue({
    draftId: DraftId.make("new-draft"),
    threadId: ThreadId.make("new-thread"),
  });
  state.prepareThread.mockReset();
  state.addToast.mockReset().mockReturnValue("checkout-toast");
  state.updateToast.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  state.status = "success";
  state.extraStatus = null;
  state.perform.mockClear();
});

const renderRow = () => (
  <ThreadDetailsPrRow
    environmentId={EnvironmentId.make("environment")}
    pr={null}
    number={1}
    status={null}
    project={null}
    label="Test PR"
    openAriaLabel="Open PR"
    onOpen={vi.fn()}
  />
);

const mergeButton = () =>
  [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.trim().startsWith("Merge"),
  )!;
const clickMerge = (timeStamp: number) => act(() => clickAt(mergeButton(), timeStamp));
const armed = () =>
  [...container.querySelectorAll("span")].some(
    (span) => span.textContent === "Confirm" && !span.hasAttribute("aria-hidden"),
  );

it("requires a new merge click after passing checks become pending and pass again", () => {
  const start = performance.now();
  act(() => root.render(renderRow()));
  clickMerge(start);
  expect(armed()).toBe(true);
  act(() => {
    state.status = "pending";
    root.render(renderRow());
  });
  act(() => {
    state.status = "success";
    root.render(renderRow());
  });
  expect(armed()).toBe(false);
  clickMerge(start + 1_000);
  expect(armed()).toBe(true);
  expect(state.perform).not.toHaveBeenCalled();
});

it("merges only on a deliberate second click", () => {
  const start = performance.now();
  act(() => root.render(renderRow()));
  clickMerge(start);
  clickMerge(start + 150);
  clickMerge(start + 300);
  expect(state.perform).not.toHaveBeenCalled();
  expect(armed()).toBe(true);
  clickMerge(start + 900);
  expect(state.perform).toHaveBeenCalledExactlyOnceWith("merge", "merge");
  expect(armed()).toBe(false);
});

it.each<[PullRequestCheck["status"], PullRequestCheck["status"]]>([
  ["success", "skipped"],
  ["failure", "cancelled"],
  ["success", "action-required"],
  ["success", "pending"],
  ["failure", "pending"],
])("omits the numeric tally for mixed check results (%s, %s)", (status, extraStatus) => {
  state.status = status;
  state.extraStatus = extraStatus;
  act(() => root.render(renderRow()));
  const counts = [...container.querySelectorAll("*")].filter((element) =>
    /^\d+\/\d+$/.test(element.textContent?.trim() ?? ""),
  );
  expect(counts).toEqual([]);
});

it("shows the current checkout recovery detail when fixing checks fails and is retried", async () => {
  state.status = "failure";
  const first = new GitManagerError({
    cwd: "/workspace",
    operation: "preparePullRequestThread",
    detail: "This PR branch is already checked out in the main repo. Use Local.",
  });
  const second = new GitCommandError({
    cwd: "/workspace",
    operation: "GitVcsDriver.createWorktree",
    command: "git worktree add",
    detail: "The worktree directory already exists. Choose another directory.",
  });
  await act(async () => {
    root.render(
      <ThreadDetailsPrRow
        environmentId={EnvironmentId.make("environment")}
        pr={null}
        number={1}
        status={null}
        project={null}
        label="Test PR"
        openAriaLabel="Open PR"
        onOpen={vi.fn()}
      />,
    );
  });

  for (const error of [first, second]) {
    state.prepareThread.mockImplementationOnce(async () => {
      state.checkoutError = error;
      return { _tag: "Failure", cause: Cause.fail(error) };
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Fix")!
        .click();
    });
  }
  expect(state.updateToast.mock.calls.map(([, toast]) => toast.description)).toEqual([
    expect.stringContaining(first.detail),
    second.detail,
  ]);
});
