// @vitest-environment jsdom

import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const commands = vi.hoisted(() => ({
  switchRef: vi.fn(),
  createRef: vi.fn(),
}));

vi.mock("../hooks/useShortcutLabel", () => ({ useShortcutLabel: () => null }));
vi.mock(import("../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../state/entities", () => ({
  useQuietThreadShell: () => null,
  useProject: (ref: { projectId: string } | null) =>
    ref ? { id: ref.projectId, workspaceRoot: `/tmp/${ref.projectId}` } : null,
}));
vi.mock("../state/threads", () => ({
  threadEnvironment: { stopSession: "stop", updateMetadata: "update" },
}));
vi.mock("../state/vcs", () => ({
  vcsEnvironment: {
    switchRef: "switch",
    createRef: "create",
    status: () => null,
    listRefs: () => null,
  },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "switch" ? commands.switchRef : commands.createRef,
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, refresh: vi.fn() }),
}));
vi.mock("../state/queries", () => ({
  usePaginatedBranches: () => ({
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
  }),
}));
vi.mock("./ThreadStatusIndicators", () => ({
  ThreadPullRequestBadgeControl: () => null,
  prStatusIndicator: () => null,
  resolveThreadPullRequestBadge: () => null,
  useLinkedThreadPullRequest: () => null,
}));
vi.mock("../lib/openPullRequestLink", () => ({ useOpenPrLink: () => vi.fn() }));
vi.mock("./ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: (toast: unknown) => toast,
}));
vi.mock("./BranchPicker", () => ({
  BranchPicker: (props: ComponentProps<typeof import("./BranchPicker").BranchPicker>) => (
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
  ),
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
let container: HTMLDivElement;
let root: Root;

function deferredCheckout() {
  type Result = { _tag: "Success"; value: { refName: string } };
  let resolve!: (result: Result) => void;
  const promise = new Promise<Result>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  commands.switchRef.mockReset();
  commands.createRef.mockReset();
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(environmentId, projectId), draftId, {
      threadId,
      branch: null,
      environmentSelection: "auto",
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root.render(
      <BranchToolbarBranchSelector
        environmentId={environmentId}
        threadId={threadId}
        draftId={draftId}
        envLocked={false}
        startFromOrigin={false}
        onStartFromOriginChange={vi.fn()}
      />,
    ),
  );
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useComposerDraftStore.getState().clearDraftThread(draftId);
  vi.unstubAllGlobals();
});

async function chooseBranch(action: "switch" | "create") {
  if (action === "create") {
    const input = container.querySelector("input")!;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "new-branch",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const button = [...container.querySelectorAll("button")].find((element) =>
    action === "switch"
      ? element.textContent === "feature/selected"
      : element.textContent?.startsWith("__create_new_branch__:"),
  )!;
  await act(() => button.click());
}

describe.each(["switch", "create"] as const)("%s branch host routing", (action) => {
  it("pins the host before checkout finishes", async () => {
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
