import { ThreadId, type ThreadPullRequestLink, type VcsStatusResult } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "../index.css";

import { render } from "../../test/render";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { makeThreadFixture } from "../test-fixtures";
import { InlineButton } from "./ui/button";

const state = vi.hoisted(() => ({
  queries: [] as string[],
  showContextMenu: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock(import("../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: (() => ({
    contextMenu: { show: state.showContextMenu },
    shell: { openExternal: state.openExternal },
  })) as never,
}));

vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useProject: () => null,
  useServerConfigs: () => new Map(),
}));
vi.mock(import("../state/vcs"), async (original) => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const statuses = Atom.family((cwd: string) =>
    Atom.make(() => {
      state.queries.push(`vcs:${cwd}`);
      return AsyncResult.success({
        isRepo: true,
        hasPrimaryRemote: true,
        isDefaultRef: false,
        refName: "feature/test",
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: {
          number: 42,
          title: "Observed worktree PR",
          url: "https://github.com/example/repo/pull/42",
          baseRef: "main",
          headRef: "feature/test",
          state: "open",
        },
      } satisfies VcsStatusResult);
    }),
  );
  const actual = await original();
  return {
    ...actual,
    vcsEnvironment: {
      ...actual.vcsEnvironment,
      status: (({ input }: { input: { cwd: string } }) => statuses(input.cwd)) as never,
    },
  };
});
vi.mock(import("../state/pullRequests"), async (importOriginal) => {
  const original = await importOriginal();
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const { ProjectId } = await import("@supaterm/contracts");
  const summaries = Atom.family((number: number) =>
    Atom.make(() => {
      state.queries.push(`pr:${number}`);
      return AsyncResult.success({
        provider: "github" as const,
        projectId: ProjectId.make("project-test"),
        repository: "example/repo",
        number,
        title: "Observed linked PR",
        url: `https://github.com/example/repo/pull/${number}`,
        state: "open" as const,
        headBranch: "feature/test",
        baseBranch: "main",
        updatedAt: "2026-09-04T00:00:00.000Z",
      });
    }),
  );
  return {
    ...original,
    linkedPullRequestDetailAtom: (({ input }: { input: { number: number } }) =>
      summaries(input.number)) as never,
  };
});
import {
  ThreadPullRequestBadgeControl,
  ThreadSearchPullRequestNumber,
  resolveThreadPullRequestBadge,
} from "./ThreadStatusIndicators";

const linkedPullRequest = (number: number, state: "open" | "merged"): ThreadPullRequestLink => ({
  host: "github.com",
  repository: "example/repo",
  number,
  url: `https://github.com/example/repo/pull/${number}`,
  source: "manual",
  linkedAt: "2026-09-04T00:00:00.000Z",
  snapshot: {
    state,
    title: `Linked PR ${number}`,
    headBranch: `feature/${number}`,
    baseBranch: "main",
    isDraft: false,
    updatedAt: "2026-09-04T00:00:00.000Z",
    syncedAt: "2026-09-04T00:00:00.000Z",
  },
  stack: null,
});

it("right-clicking the PR badge opens the pull request's menu instead of the row's", async () => {
  state.showContextMenu.mockReset().mockResolvedValue("show-linked");
  const onRowContextMenu = vi.fn();
  const onOpenList = vi.fn();
  const pullRequests = [linkedPullRequest(7, "open"), linkedPullRequest(8, "merged")];
  await using screen = await render(
    <div onContextMenu={onRowContextMenu}>
      <ThreadPullRequestBadgeControl
        render={<InlineButton tone="link" />}
        badge={resolveThreadPullRequestBadge(pullRequests)}
        pullRequests={pullRequests}
        number={7}
        url="https://github.com/example/repo/pull/7"
        status={null}
        onOpenList={onOpenList}
        onOpenPullRequest={vi.fn()}
      />
    </div>,
  );

  await userEvent.click(screen.getByRole("button"), { button: "right" });

  await vi.waitFor(() => expect(onOpenList).toHaveBeenCalledOnce());
  expect(onRowContextMenu).not.toHaveBeenCalled();
  expect(state.showContextMenu.mock.calls[0]?.[0]).toEqual([
    { id: "copy-link", label: "Copy link to #7", icon: "copy" },
    { id: "open-external", label: "Open #7 on GitHub" },
    { id: "show-linked", label: "Show linked pull requests", separatorBefore: true },
  ]);
});

it("shows the sidebar's PR badge in thread search when the query matches any linked PR", async () => {
  const thread = makeThreadFixture({
    id: ThreadId.make("search-thread"),
    pullRequests: [linkedPullRequest(7, "open"), linkedPullRequest(8, "merged")],
  });
  await using screen = await render(
    <AppAtomRegistryProvider>
      <span data-testid="match">
        <ThreadSearchPullRequestNumber thread={thread} query="#8" />
      </span>
      <span data-testid="miss">
        <ThreadSearchPullRequestNumber thread={thread} query="#9" />
      </span>
    </AppAtomRegistryProvider>,
  );
  const match = screen.container.querySelector('[data-testid="match"] > span')!;
  expect(match.textContent).toBe("+2");
  expect(match.getAttribute("aria-label")).toContain("and 1 more linked; overall open");
  expect(match.querySelector("svg")).not.toBeNull();
  expect(screen.container.querySelector('[data-testid="miss"]')!.childElementCount).toBe(0);
});
