import { EnvironmentId, ThreadId } from "@supaterm/contracts";
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
      <ThreadRelationshipsPanel environmentId={environmentId} threadId={threadId} />
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
      <ThreadRelationshipsPanel environmentId={environmentId} threadId={threadId} />
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
