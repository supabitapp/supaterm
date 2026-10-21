import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { type ComponentProps } from "react";
import { act, render as renderUi, type Screen } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

const commands = vi.hoisted(() => ({
  switchRef: vi.fn(),
  createRef: vi.fn(),
}));

vi.mock(import("../hooks/useShortcutLabel"), async (original) => ({
  ...(await original()),
  useShortcutLabel: () => null,
}));
vi.mock(import("../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShell: (() => null) as never,
  useProject: ((ref: { projectId: string } | null) =>
    ref ? { id: ref.projectId, workspaceRoot: `/tmp/${ref.projectId}` } : null) as never,
}));
vi.mock(import("../state/threads"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    threadEnvironment: {
      ...actual.threadEnvironment,
      stopSession: "stop",
      updateMetadata: "update",
    } as never,
  };
});
vi.mock(import("../state/vcs"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    vcsEnvironment: {
      ...actual.vcsEnvironment,
      switchRef: "switch",
      createRef: "create",
      status: () => null,
      listRefs: () => null,
    } as never,
  };
});
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: string) =>
    command === "switch" ? commands.switchRef : commands.createRef) as never,
}));
vi.mock(import("../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({ data: null, refresh: vi.fn() })) as never,
}));
vi.mock(import("../state/queries"), async (original) => ({
  ...(await original()),
  usePaginatedBranches: (() => ({
    refs: [
      {
        name: "feature/selected",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ],
    data: { nextCursor: null, totalCount: 1 },
    isPending: false,
    isFetchingNextPage: false,
    loadNext: vi.fn(),
    refresh: vi.fn(),
  })) as never,
}));
vi.mock(import("./ThreadStatusIndicators"), async (original) => ({
  ...(await original()),
  ThreadPullRequestBadgeControl: () => null,
  prStatusIndicator: () => null,
  resolveThreadPullRequestBadge: () => null,
  useLinkedThreadPullRequest: () => null,
}));
vi.mock(import("../lib/openPullRequestLink"), async (original) => ({
  ...(await original()),
  useOpenPrLink: () => vi.fn(),
}));
vi.mock(import("./ui/toast"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    toastManager: { ...actual.toastManager, add: vi.fn() },
    stackedThreadToast: ((toast: unknown) => toast) as never,
  };
});
vi.mock(import("./BranchPicker"), async (original) => ({
  ...(await original()),
  BranchPicker: ((props: ComponentProps<typeof import("./BranchPicker").BranchPicker>) => (
    <div>
      <input
        aria-label="Search branches"
        value={props.query}
        onChange={(event) => props.onQueryChange(event.target.value)}
      />
      {props.filteredItems.map((item) => (
        <button key={item} onClick={() => props.onSelectItem(item)}>
          {item}
        </button>
      ))}
    </div>
  )) as never,
}));

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("thread");
const draftId = "draft:branch-host" as DraftId;
const remoteProjectRef = scopeProjectRef(
  EnvironmentId.make("remote"),
  ProjectId.make("remote-project"),
);
let screen: Screen;

function deferredCheckout() {
  type Result = { _tag: "Success"; value: { refName: string } };
  let resolve!: (result: Result) => void;
  const promise = new Promise<Result>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setupTest() {
  await using resources = new AsyncDisposableStack();
  resources.defer(() => {
    useComposerDraftStore.getState().clearDraftThread(draftId);
  });

  commands.switchRef.mockReset();
  commands.createRef.mockReset();
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(environmentId, projectId), draftId, {
      threadId,
      branch: null,
      environmentSelection: "auto",
    });
  screen = resources.use(
    await renderUi(
      <BranchToolbarBranchSelector
        environmentId={environmentId}
        threadId={threadId}
        draftId={draftId}
        envLocked={false}
        startFromOrigin={false}
        onStartFromOriginChange={vi.fn()}
      />,
      { router: false },
    ),
  );

  return resources.move();
}

async function chooseBranch(action: "switch" | "create") {
  if (action === "create") {
    const input = screen.container.querySelector("input")!;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "new-branch",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const button = [...screen.container.querySelectorAll("button")].find((element) =>
    action === "switch"
      ? element.textContent === "feature/selected"
      : element.textContent?.startsWith("__create_new_branch__:"),
  )!;
  await act(() => button.click());
}

describe.each(["switch", "create"] as const)("%s branch host routing", (action) => {
  it("pins the host before checkout finishes", async () => {
    await using _test = await setupTest();
    const checkout = deferredCheckout();
    const command = action === "switch" ? commands.switchRef : commands.createRef;
    command.mockReturnValue(checkout.promise);

    await chooseBranch(action);

    expect(command).toHaveBeenCalledOnce();
    expect(useComposerDraftStore.getState().getDraftSession(draftId)).toMatchObject({
      environmentId,
      projectId,
      environmentSelection: "manual",
      branch: null,
    });

    await act(() => checkout.resolve({ _tag: "Success", value: { refName: "new-branch" } }));
    expect(useComposerDraftStore.getState().getDraftSession(draftId)?.branch).toBe(
      action === "switch" ? "feature/selected" : "new-branch",
    );
  });

  it("keeps a later host choice when the old checkout finishes", async () => {
    await using _test = await setupTest();
    const checkout = deferredCheckout();
    const command = action === "switch" ? commands.switchRef : commands.createRef;
    command.mockReturnValue(checkout.promise);
    await chooseBranch(action);

    await act(() => {
      useComposerDraftStore.getState().setDraftThreadContext(draftId, {
        projectRef: remoteProjectRef,
        environmentSelection: "manual",
        branch: "remote-branch",
      });
    });
    await act(() => checkout.resolve({ _tag: "Success", value: { refName: "new-branch" } }));

    expect(useComposerDraftStore.getState().getDraftSession(draftId)).toMatchObject({
      environmentId: remoteProjectRef.environmentId,
      projectId: remoteProjectRef.projectId,
      branch: "remote-branch",
      environmentSelection: "manual",
    });
  });
});
