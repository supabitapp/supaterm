import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  ThreadId,
  type PullRequestCheck,
} from "@supaterm/contracts";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const state = vi.hoisted(() => ({
  prState: "open" as "open" | "closed" | "merged",
  status: "success" as PullRequestCheck["status"],
  extraStatus: null as PullRequestCheck["status"] | null,
  mergeMethods: ["merge"] as Array<"merge" | "squash" | "rebase">,
  perform: fake(),
  newThread: fake(),
  prepareThread: fake(),
  checkoutError: null as Error | null,
  addToast: fake(),
  updateToast: fake(),
  projects: [] as unknown[],
  pullRequests: [] as unknown[],
  projectMergeMethods: {} as Record<string, "merge" | "squash" | "rebase">,
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useServerConfigs: (() =>
    new Map([
      [
        EnvironmentId.make("environment"),
        { environment: { capabilities: { pullRequests: true } } },
      ],
    ])) as never,
  useProjects: (() => state.projects) as never,
  useQuietThreadShell: ((ref: unknown) =>
    ref === null ? null : { branch: null, pullRequests: state.pullRequests }) as never,
}));
const queryData = () => ({
  projectId: ProjectId.make("project"),
  workspaceRoot: "/workspace",
  url: "https://github.com/owner/repo/pull/1",
  number: 1,
  title: "Test PR",
  state: state.prState,
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
  capabilities: { actions: ["merge"], mergeMethods: state.mergeMethods },
  viewerPermissions: { actions: ["merge"] },
  mergeCapabilities: {
    merge: state.mergeMethods.includes("merge"),
    squash: state.mergeMethods.includes("squash"),
    rebase: state.mergeMethods.includes("rebase"),
  },
});
vi.mock(import("~/state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuerySelector: ((_atom: unknown, select: (result: unknown) => unknown) =>
    select(AsyncResult.success(queryData()))) as never,
  useEnvironmentQueryIsNewer: () => true,
  useEnvironmentQueryRefresh: (() => ({ refresh: vi.fn(), isPending: () => false })) as never,
  useEnvironmentQuery: (() => ({
    data: {
      code: { additions: 1, deletions: 0 },
      tests: { additions: 0, deletions: 0 },
      mocks: { additions: 0, deletions: 0 },
      generated: { additions: 0, deletions: 0 },
      docs: { additions: 7, deletions: 3 },
    },
    isPending: false,
  })) as never,
}));
vi.mock(import("../pullRequest/usePullRequestActions"), async (importOriginal) => ({
  ...(await importOriginal()),
  usePullRequestActionRunner: () => ({
    actionPending: false,
    pendingAction: null,
    perform: state.perform as never,
  }),
  usePullRequestDefaultMergeMethod: ((_environmentId: unknown, projectId: unknown) =>
    state.projectMergeMethods[String(projectId)]) as never,
}));

import { clickAt } from "~/test/inlineConfirm";
vi.mock(import("~/hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => state.newThread) as never,
}));
vi.mock(import("~/state/sourceControlActions"), async (original) => ({
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

import { act, render as renderUi } from "../../../test/render";
import { useUiStateStore } from "~/uiStateStore";
import { ThreadDetailsPrRow } from "./ThreadDetailsPrRow";
import { ThreadDetailsThreadPrRows } from "./ThreadDetailsPrRows";

const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));

const scratchProject = {
  id: ProjectId.make("scratch"),
  environmentId: EnvironmentId.make("environment"),
  title: "No project",
  workspaceRoot: "/home/user/.supaterm/scratch",
  scripts: [],
};
const repositoryProject = {
  id: ProjectId.make("repository"),
  environmentId: EnvironmentId.make("environment"),
  title: "repo",
  workspaceRoot: "/work/repo",
  scripts: [],
  repositoryIdentity: {
    canonicalKey: "github.com/owner/repo",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "https://github.com/owner/repo.git",
    },
    provider: SourceControlProviderKind.make("github"),
    owner: "owner",
    name: "repo",
    displayName: "owner/repo",
  },
};

const renderRow = () => (
  <ThreadDetailsPrRow
    environmentId={EnvironmentId.make("environment")}
    pr={null}
    number={1}
    status={null}
    project={null}
    title="Test PR"
    openAriaLabel="Open PR"
    composerTarget={threadRef}
    onOpen={vi.fn()}
  />
);

it("fills this thread's composer with a subagent hand-off for failing checks", async () => {
  await using screen = await setup();

  state.status = "failure";
  await act(async () => await screen.rerender(renderRow()));
  const fixButton = [...screen.container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Fix",
  )!;
  await act(() => fixButton.click());

  const prompt = useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt ?? "";
  expect(prompt).toContain("subagent");
  expect(prompt).toContain("CI-failure");
  expect(state.newThread).not.toHaveBeenCalled();
  expect(state.prepareThread).not.toHaveBeenCalled();
});

it("merges with the last selected merge method", async () => {
  await using screen = await setup();
  const { clickMerge } = screen;

  state.mergeMethods = ["merge", "squash"];
  useUiStateStore.getState().setPullRequestMergeMethod("squash");
  const start = 1_000;
  await act(async () => await screen.rerender(renderRow()));
  await clickMerge(start);
  await clickMerge(start + 900);
  expect(state.perform).toHaveBeenCalledExactlyOnceWith("merge", "squash");
});

it("requires a new merge click after passing checks become pending and pass again", async () => {
  await using screen = await setup();
  const { clickMerge, armed } = screen;

  const start = 1_000;
  await act(async () => await screen.rerender(renderRow()));
  await clickMerge(start);
  expect(armed()).toBe(true);
  await act(async () => {
    state.status = "pending";
    await screen.rerender(renderRow());
  });
  await act(async () => {
    state.status = "success";
    await screen.rerender(renderRow());
  });
  expect(armed()).toBe(false);
  await clickMerge(start + 1_000);
  expect(armed()).toBe(true);
  expect(state.perform).not.toHaveBeenCalled();
});

it("drops the checks control once the pull request merges with checks still pending", async () => {
  await using screen = await setup();
  const checksControl = () => screen.container.querySelector('[aria-label^="Open checks"]');

  state.status = "pending";
  await act(async () => await screen.rerender(renderRow()));
  expect(checksControl()).not.toBeNull();
  await act(async () => {
    state.prState = "merged";
    await screen.rerender(renderRow());
  });
  expect(checksControl()).toBeNull();
});

it("merges only on a deliberate second click", async () => {
  await using screen = await setup();
  const { clickMerge, armed } = screen;

  const start = 1_000;
  await screen.rerender(renderRow());
  await clickMerge(start);
  await clickMerge(start + 150);
  expect(state.perform).not.toHaveBeenCalled();
  expect(armed()).toBe(true);
  await clickMerge(start + 300);
  expect(state.perform).toHaveBeenCalledExactlyOnceWith("merge", "merge");
  expect(armed()).toBe(false);
});

it.each<[PullRequestCheck["status"], PullRequestCheck["status"]]>([
  ["success", "skipped"],
  ["failure", "cancelled"],
  ["success", "action-required"],
  ["success", "pending"],
  ["failure", "pending"],
])("omits the numeric tally for mixed check results (%s, %s)", async (status, extraStatus) => {
  await using screen = await setup();
  const { container } = screen;

  state.status = status;
  state.extraStatus = extraStatus;
  await act(async () => await screen.rerender(renderRow()));
  const counts = [...container.querySelectorAll("*")].filter((element) =>
    /^\d+\/\d+$/.test(element.textContent?.trim() ?? ""),
  );
  expect(counts).toEqual([]);
});

async function setup() {
  state.perform.reset();
  state.checkoutError = null;
  state.newThread.reset(async () => ({
    draftId: DraftId.make("new-draft"),
    threadId: ThreadId.make("new-thread"),
  }));
  state.prepareThread.reset();
  state.addToast.reset(() => "checkout-toast");
  state.updateToast.reset();

  state.prState = "open";
  state.status = "success";
  state.extraStatus = null;
  state.mergeMethods = ["merge"];
  state.projects = [];
  state.pullRequests = [];
  state.projectMergeMethods = {};
  useComposerDraftStore.getState().clearComposerContent(threadRef);
  useUiStateStore.getState().setPullRequestMergeMethod("merge");
  const screen = await renderUi(null);
  const { container } = screen;
  const mergeButton = () =>
    [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.trim().startsWith("Merge"),
    )!;
  const clickMerge = (timeStamp: number) => act(() => clickAt(mergeButton(), timeStamp));
  const armed = () =>
    [...container.querySelectorAll("span")].some(
      (span) => span.textContent === "Confirm" && !span.hasAttribute("aria-hidden"),
    );

  return Object.assign(screen, { clickMerge, armed });
}

const repositoryClone = {
  ...repositoryProject,
  id: ProjectId.make("clone"),
  workspaceRoot: "/work/clone",
};

it.each([
  {
    name: "the project holding its repository, not the No project thread's",
    thread: scratchProject,
    repository: "owner/repo",
    expected: "rebase",
  },
  {
    name: "the thread's own project when it holds the repository too",
    thread: repositoryClone,
    repository: "owner/repo",
    expected: "merge",
  },
  {
    name: "the thread's project when no project holds the repository",
    thread: scratchProject,
    repository: "owner/other",
    expected: "squash",
  },
])("merges a linked pull request with $name", async ({ thread, repository, expected }) => {
  await using screen = await setup();
  state.mergeMethods = ["merge", "squash", "rebase"];
  state.projects = [scratchProject, repositoryProject, repositoryClone];
  state.projectMergeMethods = { scratch: "squash", repository: "rebase", clone: "merge" };
  useUiStateStore.getState().setPullRequestMergeMethod("squash");
  state.pullRequests = [
    {
      host: "github.com",
      repository,
      number: 1,
      url: `https://github.com/${repository}/pull/1`,
      source: "manual",
      linkedAt: "2026-10-30T00:00:00.000Z",
      snapshot: null,
      stack: null,
    },
  ];
  await act(
    async () =>
      await screen.rerender(
        <ThreadDetailsThreadPrRows
          threadRef={threadRef}
          project={thread as never}
          composerTarget={threadRef}
        />,
      ),
  );
  await screen.clickMerge(1_000);
  await screen.clickMerge(1_900);
  expect(state.perform).toHaveBeenCalledExactlyOnceWith("merge", expected);
});
