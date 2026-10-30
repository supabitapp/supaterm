import { EnvironmentId, ProjectId, ProviderDriverKind } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { DraftId } from "../../draftId";
import { useDraftEnvironmentRouting } from "./useDraftEnvironmentRouting";

const mocks = vi.hoisted(() => ({
  openScratchProject: vi.fn(),
  setDraftThreadContext: vi.fn(),
}));

vi.mock("../../hooks/useLoadBalancedEnvironment", () => ({
  useLoadBalancedEnvironment: () => ({ pending: false, environmentId: null, refresh: () => {} }),
}));
vi.mock("../../hooks/useScratchProject", () => ({
  useScratchProject: () => ({ openScratchProject: mocks.openScratchProject }),
}));
vi.mock("../../state/entities", () => ({ useProjects: () => [] }));
vi.mock("../../composerDraftStore", () => ({
  useComposerDraftStore: (
    select: (state: {
      getDraftSession: () => { environmentId: string; projectId: string };
      setDraftThreadContext: typeof mocks.setDraftThreadContext;
      setLogicalProjectDraftThreadId: () => void;
    }) => unknown,
  ) =>
    select({
      getDraftSession: () => ({ environmentId: "original", projectId: "original" }),
      setDraftThreadContext: mocks.setDraftThreadContext,
      setLogicalProjectDraftThreadId: () => {},
    }),
}));

const targetEnvironmentId = EnvironmentId.make("target");

function Routing({ scope = "first" }: { scope?: string }) {
  const routing = useDraftEnvironmentRouting({
    draftId: DraftId.make(scope),
    draftThread: null,
    envLocked: false,
    automaticEnvironment: false,
    logicalProjectEnvironments: [
      {
        environmentId: targetEnvironmentId,
        projectId: null,
        label: "Target",
        isPrimary: false,
        machine: "desktop",
      },
    ],
    environmentById: new Map(),
    providersByEnvironment: new Map(),
    loadBalancingSettings: { loadBalancingWeights: {} },
    referencedThreadContexts: [],
    activeProviderInstanceId: null,
    selectedProvider: ProviderDriverKind.make("codex"),
    composerHasAttachments: false,
    activeProjectKey: scope,
    activeProjectIsScratch: false,
    projectGroupingSettings: {
      sidebarProjectGroupingMode: "repository",
      sidebarProjectGroupingOverrides: {},
    },
    sendInFlightRef: { current: false },
  });
  return (
    <button onClick={() => routing.onEnvironmentChangeStable(targetEnvironmentId)}>
      {routing.isEnvironmentChanging ? "Switching" : "Switch"}
    </button>
  );
}

function pendingProject() {
  let resolve!: (project: { id: ProjectId } | null) => void;
  const promise = new Promise<{ id: ProjectId } | null>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

it("abandons the previous scope without allowing its response to clear a newer switch", async () => {
  const old = pendingProject();
  const current = pendingProject();
  mocks.setDraftThreadContext.mockReset();
  mocks.openScratchProject
    .mockReset()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  await using screen = await render(<Routing />, { router: false });
  await screen.getByRole("button").click();
  await expect.element(screen.getByRole("button")).toHaveTextContent("Switching");

  await screen.rerender(<Routing scope="second" />);
  await expect.element(screen.getByRole("button", { name: "Switch", exact: true })).toBeVisible();
  await screen.getByRole("button").click();
  await act(async () => {
    old.resolve({ id: ProjectId.make("old-project") });
    await old.promise;
  });
  await expect.element(screen.getByRole("button")).toHaveTextContent("Switching");
  expect(mocks.setDraftThreadContext).not.toHaveBeenCalled();

  await act(async () => {
    current.resolve({ id: ProjectId.make("current-project") });
    await current.promise;
  });
  await expect.element(screen.getByRole("button", { name: "Switch", exact: true })).toBeVisible();
  expect(mocks.setDraftThreadContext).toHaveBeenCalledTimes(1);
  expect(mocks.setDraftThreadContext).toHaveBeenCalledWith(DraftId.make("second"), {
    projectRef: {
      environmentId: targetEnvironmentId,
      projectId: ProjectId.make("current-project"),
    },
    environmentSelection: "manual",
    loadBalancedEnvironmentId: null,
  });
});
