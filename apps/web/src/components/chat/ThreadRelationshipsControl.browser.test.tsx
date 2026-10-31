import { EnvironmentId, NodeId, ThreadId } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({ projection: null as unknown, commandSucceeds: false }));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => false) as never,
}));

vi.mock(import("../../state/entities"), () => ({
  useQuietThreadShell: (() => null) as never,
  useThreadProjection: ((ref: unknown) =>
    ref === null ? null : { projection: state.projection }) as never,
  useThreadRelationshipShells: (() =>
    state.projection === null ? [] : [(state.projection as { thread: unknown }).thread]) as never,
  useProjects: (() => []) as never,
}));
vi.mock(import("../../state/environments"), () => ({
  useEnvironment: (() => null) as never,
  useEnvironmentProviders: (() => new Map()) as never,
}));
vi.mock(import("../../lib/archivedThreadsState"), () => ({
  useArchivedThreadSnapshots: (() => ({ snapshots: [] })) as never,
}));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: (() => async () =>
    state.commandSucceeds
      ? AsyncResult.success(undefined)
      : AsyncResult.failure(Cause.fail(new Error("Connection lost")))) as never,
}));

import { render } from "../../../test/render";
import { makeThreadProjectionFixture } from "../../test-fixtures";
import { ToastProvider } from "../ui/toast";
import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("fork");

function setup() {
  state.commandSucceeds = false;
  state.projection = {
    thread: {
      id: threadId,
      title: "Fork",
      activeProviderThreadId: null,
      lineage: { parentThreadId: ThreadId.make("source"), relationshipToParent: "fork" },
      forkedFrom: null,
    },
    runs: [{ id: "run", ordinal: 1, status: "completed" }],
    subagents: [],
    contextTransfers: [],
    providerThreads: [],
    providerSessions: [{ id: "session", status: "ready" }],
  };
}

it("reports a rejected merge-back and clears the busy state", async () => {
  setup();
  await using screen = await render(
    <ToastProvider timeout={0}>
      <ThreadRelationshipsPanel
        environmentId={environmentId}
        threadId={threadId}
        showLineage
        showSideChats
      />
    </ToastProvider>,
  );
  const mergeButton = screen.getByRole("button", { name: "Merge back to source conversation" });

  await mergeButton.click();

  await expect.element(page.getByText("Could not merge back", { exact: true })).toBeVisible();
  await expect.element(mergeButton).toBeEnabled();
});

it("clears the previous merge-back error after a successful retry", async () => {
  setup();
  await using screen = await render(
    <ToastProvider timeout={0}>
      <ThreadRelationshipsPanel
        environmentId={environmentId}
        threadId={threadId}
        showLineage
        showSideChats
      />
    </ToastProvider>,
    { router: "/environment/fork" },
  );
  const mergeButton = screen.getByRole("button", { name: "Merge back to source conversation" });

  await mergeButton.click();
  await expect.element(page.getByText("Could not merge back", { exact: true })).toBeVisible();
  expect(screen.router?.state.location.pathname).toBe("/environment/fork");

  state.commandSucceeds = true;
  await mergeButton.click();

  await expect
    .element(page.getByText("Could not merge back", { exact: true }))
    .not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(screen.router?.state.location.pathname).toBe("/environment/source");
  });
});

it("opens an idle child from Lineage when its shell has not been loaded", async () => {
  setup();
  const projection = makeThreadProjectionFixture();
  const childId = ThreadId.make("omitted-child");
  const environmentId = EnvironmentId.make("local");
  state.projection = {
    ...projection,
    subagents: [
      {
        id: NodeId.make("agent"),
        threadId: projection.thread.id,
        runId: null,
        parentNodeId: NodeId.make("parent"),
        origin: "app_owned",
        createdBy: "agent",
        driver: "codex",
        providerInstanceId: projection.thread.providerInstanceId,
        providerThreadId: null,
        childThreadId: childId,
        nativeTaskRef: null,
        prompt: "Inspect the change",
        title: "Idle child",
        model: null,
        status: "completed",
        result: null,
        startedAt: null,
        completedAt: projection.thread.updatedAt,
        updatedAt: projection.thread.updatedAt,
      },
    ],
  };
  await using screen = await render(
    <ThreadRelationshipsPanel
      environmentId={environmentId}
      threadId={projection.thread.id}
      showLineage
      showSideChats
    />,
  );
  await screen.getByRole("button", { name: /Previous agents/ }).click();
  const child = screen.getByRole("button", { name: /Idle child/ });
  await expect.element(child).toBeEnabled();
  await child.click();
  await vi.waitFor(() =>
    expect(screen.router?.state.location.pathname).toBe("/local/omitted-child"),
  );
});
