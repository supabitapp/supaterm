import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { EnvironmentId, RunId, ThreadId } from "@supaterm/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { useChatPaneStore } from "../chatPanes/store";
import {
  BackgroundThreadAnnouncer,
  startBackgroundThreadAnnouncements,
} from "./BackgroundThreadAnnouncer";

const atoms = await vi.hoisted(async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    shells: Atom.make<ReadonlyArray<unknown>>([]).pipe(Atom.keepAlive),
    liveEnvironmentIds: Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive),
  };
});
vi.mock("../state/threads", () => ({
  environmentThreadShells: { quietThreadShellsAtom: atoms.shells },
}));
vi.mock("../state/shell", () => ({ liveShellEnvironmentIdsAtom: atoms.liveEnvironmentIds }));

const environmentId = EnvironmentId.make("environment-announcer");
const routeThread = ThreadId.make("route-thread");
const paneThread = ThreadId.make("pane-thread");

const shell = (id: ThreadId, title: string, runId: string, status: string) => ({
  environmentId,
  id,
  title,
  archivedAt: null,
  lineage: { relationshipToParent: null },
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingSubagentRequest: null,
  source: { pendingRuntimeRequest: null },
  latestRun: { runId: RunId.make(runId), status },
  runtime: { activeRunId: null },
  snoozedUntil: null,
});

it("announces a split-pane thread finishing once the panes are no longer on screen", async () => {
  await using resources = new AsyncDisposableStack();
  resources.defer(() => {
    useChatPaneStore.setState({ layout: null, closed: [], openToSide: null });
  });
  const store = useChatPaneStore.getState();
  store.reconcileRoute(
    { kind: "server", threadRef: scopeThreadRef(environmentId, routeThread) },
    { width: 1600, height: 900 },
  );
  store.split(useChatPaneStore.getState().layout!.focusedPaneId, "right", {
    kind: "server",
    threadRef: scopeThreadRef(environmentId, paneThread),
  });

  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren(
      ["/$environmentId/$threadId", "/pull-requests"].map((path) =>
        createRoute({ getParentRoute: () => root, path }),
      ),
    ),
    history: createMemoryHistory({
      initialEntries: [`/${encodeURIComponent(environmentId)}/${routeThread}`],
    }),
  });
  const registry = AtomRegistry.make();
  registry.set(atoms.liveEnvironmentIds, new Set([environmentId]));
  const setPaneRun = (runId: string, status: string) =>
    act(() =>
      registry.set(atoms.shells, [
        shell(routeThread, "Fix login redirect", "run-route", "completed"),
        shell(paneThread, "Update docs", runId, status),
      ]),
    );
  await setPaneRun("run-1", "running");
  const screen = resources.use(
    await render(
      <>
        <RouterProvider router={router} />
        <BackgroundThreadAnnouncer />
      </>,
      { router: false },
    ),
  );
  resources.defer(startBackgroundThreadAnnouncements(registry, router));
  const region = page.elementLocator(screen.container.querySelector("[aria-live]")!);

  // The thread route shows both panes, and each pane speaks for its own thread.
  await setPaneRun("run-1", "completed");
  expect(region.element().textContent).toBe("");

  await act(() => router.history.push("/pull-requests"));
  await setPaneRun("run-2", "running");
  await setPaneRun("run-2", "completed");
  await expect.element(region).toHaveTextContent("Done: Update docs");
});
