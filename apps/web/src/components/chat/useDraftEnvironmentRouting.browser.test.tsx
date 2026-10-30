import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type HostResourcesSnapshot,
  type ServerProvider,
} from "@supaterm/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { useDraftEnvironmentRouting } from "./useDraftEnvironmentRouting";

const mocks = vi.hoisted(() => ({ openScratchProject: vi.fn() }));
const resources = new Map<
  EnvironmentId,
  Atom.Writable<AsyncResult.AsyncResult<HostResourcesSnapshot>>
>();

vi.mock("../../hooks/useScratchProject", () => ({
  useScratchProject: () => ({ openScratchProject: mocks.openScratchProject }),
}));
vi.mock("../../state/entities", () => ({ useProjects: () => [] }));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    hostResources: ({ environmentId }: { environmentId: EnvironmentId }) =>
      resources.get(environmentId)!,
  },
}));

const originalEnvironmentId = EnvironmentId.make("original");
const targetEnvironmentId = EnvironmentId.make("target");
const projectId = ProjectId.make("project");
const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-01T00:00:00.000Z",
  models: [],
  skills: [],
  slashCommands: [],
};
const environments = [originalEnvironmentId, targetEnvironmentId];
const environmentById = new Map(
  environments.map((id) => [
    id,
    {
      connection: { phase: "connected" as const, error: null, traceId: null },
      serverConfig: null,
    },
  ]),
);
const providersByEnvironment = new Map(environments.map((id) => [id, [provider]]));

function Routing({
  scope = "first",
  automatic = false,
  sendInFlight = false,
  attachments = false,
}: {
  scope?: string;
  automatic?: boolean;
  sendInFlight?: boolean;
  attachments?: boolean;
}) {
  const draftId = DraftId.make(scope);
  const draftThread = useComposerDraftStore((state) => state.getDraftSession(draftId));
  const routing = useDraftEnvironmentRouting({
    draftId,
    draftThread,
    envLocked: false,
    automaticEnvironment:
      automatic && draftThread?.environmentSelection !== "manual" && !attachments,
    logicalProjectEnvironments: (automatic ? environments : [targetEnvironmentId]).map(
      (environmentId) => ({
        environmentId,
        projectId: automatic ? projectId : null,
        label: environmentId,
        isPrimary: false,
        machine: "desktop",
      }),
    ),
    environmentById,
    providersByEnvironment,
    loadBalancingSettings: { loadBalancingWeights: {} },
    referencedThreadContexts: [],
    activeProviderInstanceId: null,
    selectedProvider: provider.driver,
    composerHasAttachments: attachments,
    activeProjectKey: scope,
    activeProjectIsScratch: false,
    projectGroupingSettings: {
      sidebarProjectGroupingMode: "repository",
      sidebarProjectGroupingOverrides: {},
    },
    sendInFlightRef: { current: sendInFlight },
  });
  return (
    <>
      <button onClick={() => routing.onEnvironmentChangeStable(targetEnvironmentId)}>
        {routing.isEnvironmentChanging ? "Switching" : "Switch"}
      </button>
      <button onClick={routing.onAutoEnvironmentStable}>Auto</button>
      <output>{draftThread?.loadBalancedEnvironmentId ?? "unresolved"}</output>
    </>
  );
}

function pendingProject() {
  let resolve!: (project: { id: ProjectId } | null) => void;
  const promise = new Promise<{ id: ProjectId } | null>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function ready(cpuUtilization: number) {
  return AsyncResult.success({
    sampledAt: 0,
    cpuUtilization,
    cpuCount: 8,
    availableMemoryBytes: 8,
    totalMemoryBytes: 16,
  });
}

function setup() {
  const previousDraftState = useComposerDraftStore.getState();
  const registry = AtomRegistry.make();
  resources.clear();
  for (const id of environments)
    resources.set(
      id,
      Atom.make<AsyncResult.AsyncResult<HostResourcesSnapshot>>(AsyncResult.initial()).pipe(
        Atom.keepAlive,
      ),
    );
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
  for (const scope of ["first", "second"]) {
    useComposerDraftStore
      .getState()
      .setLogicalProjectDraftThreadId(
        scope,
        { environmentId: originalEnvironmentId, projectId },
        DraftId.make(scope),
      );
  }
  mocks.openScratchProject.mockReset();
  return {
    registry,
    [Symbol.dispose]() {
      registry.dispose();
      useComposerDraftStore.setState(previousDraftState, true);
      resources.clear();
    },
  };
}

it("abandons the previous scope without allowing its response to clear a newer switch", async () => {
  using _test = setup();
  using setDraftThreadContext = vi.spyOn(useComposerDraftStore.getState(), "setDraftThreadContext");
  const old = pendingProject();
  const current = pendingProject();
  mocks.openScratchProject.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  await using screen = await render(<Routing />, { router: false });
  await screen.getByRole("button", { name: "Switch", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "Switching" })).toBeVisible();

  await screen.rerender(<Routing scope="second" />);
  await expect.element(screen.getByRole("button", { name: "Switch", exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Switch", exact: true }).click();
  await act(async () => {
    old.resolve({ id: ProjectId.make("old-project") });
    await old.promise;
  });
  await expect.element(screen.getByRole("button", { name: "Switching" })).toBeVisible();
  expect(
    useComposerDraftStore.getState().getDraftSession(DraftId.make("first"))?.environmentId,
  ).toBe(originalEnvironmentId);
  expect(setDraftThreadContext).not.toHaveBeenCalled();

  await act(async () => {
    current.resolve({ id: ProjectId.make("current-project") });
    await current.promise;
  });
  await expect.element(screen.getByRole("button", { name: "Switch", exact: true })).toBeVisible();
  expect(setDraftThreadContext).toHaveBeenCalledTimes(1);
  expect(setDraftThreadContext).toHaveBeenCalledWith(DraftId.make("second"), {
    projectRef: {
      environmentId: targetEnvironmentId,
      projectId: ProjectId.make("current-project"),
    },
    environmentSelection: "manual",
    loadBalancedEnvironmentId: null,
  });
  expect(useComposerDraftStore.getState().getDraftSession(DraftId.make("second"))).toMatchObject({
    environmentId: targetEnvironmentId,
    projectId: ProjectId.make("current-project"),
    environmentSelection: "manual",
    loadBalancedEnvironmentId: null,
  });
});

it("selects after every host settles, then refreshes the choice without losing the prompt", async () => {
  using test = setup();
  const { registry } = test;
  useComposerDraftStore.getState().setPrompt(DraftId.make("first"), "Keep this draft");
  await using screen = await render(
    <RegistryContext value={registry}>
      <Routing automatic />
    </RegistryContext>,
    { router: false },
  );
  await act(() => registry.set(resources.get(originalEnvironmentId)!, ready(0.8)));
  await expect.element(screen.getByRole("status")).toHaveTextContent("unresolved");
  await act(() => registry.set(resources.get(targetEnvironmentId)!, ready(0.1)));
  await expect.element(screen.getByRole("status")).toHaveTextContent(targetEnvironmentId);
  expect(useComposerDraftStore.getState().getComposerDraft(DraftId.make("first"))?.prompt).toBe(
    "Keep this draft",
  );

  await screen.getByRole("button", { name: "Auto", exact: true }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("unresolved");
  await act(() => {
    registry.set(resources.get(originalEnvironmentId)!, ready(0.1));
    registry.set(resources.get(targetEnvironmentId)!, ready(0.8));
  });
  await expect.element(screen.getByRole("status")).toHaveTextContent(originalEnvironmentId);
  expect(useComposerDraftStore.getState().getComposerDraft(DraftId.make("first"))?.prompt).toBe(
    "Keep this draft",
  );
});

it("falls back to a candidate when host probes return defects", async () => {
  using test = setup();
  for (const environmentId of environments) {
    test.registry.set(
      resources.get(environmentId)!,
      AsyncResult.failure(Cause.die("probe failed")),
    );
  }
  await using screen = await render(
    <RegistryContext value={test.registry}>
      <Routing automatic />
    </RegistryContext>,
    { router: false },
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent(originalEnvironmentId);
});

it("routes an initial automatic draft from cached host replies", async () => {
  using test = setup();
  test.registry.set(resources.get(originalEnvironmentId)!, ready(0.8));
  test.registry.set(resources.get(targetEnvironmentId)!, ready(0.1));
  await using screen = await render(
    <RegistryContext value={test.registry}>
      <Routing automatic />
    </RegistryContext>,
    { router: false },
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent(targetEnvironmentId);
});

it.each(["scope", "manual", "attachments", "sending", "unmount"] as const)(
  "discards a pending automatic choice after %s changes",
  async (change) => {
    using test = setup();
    const { registry } = test;
    await using screen = await render(
      <RegistryContext value={registry}>
        <Routing automatic />
      </RegistryContext>,
      { router: false },
    );
    if (change === "scope")
      await screen.rerender(
        <RegistryContext value={registry}>
          <Routing scope="second" />
        </RegistryContext>,
      );
    if (change === "manual")
      await act(() =>
        useComposerDraftStore
          .getState()
          .setDraftThreadContext(DraftId.make("first"), { environmentSelection: "manual" }),
      );
    if (change === "attachments") {
      await screen.rerender(
        <RegistryContext value={registry}>
          <Routing automatic attachments />
        </RegistryContext>,
      );
      await screen.getByRole("button", { name: "Auto", exact: true }).click();
    }
    if (change === "sending")
      await screen.rerender(
        <RegistryContext value={registry}>
          <Routing automatic sendInFlight />
        </RegistryContext>,
      );
    if (change === "unmount") await screen.unmount();
    await act(() => {
      registry.set(resources.get(originalEnvironmentId)!, ready(0.8));
      registry.set(resources.get(targetEnvironmentId)!, ready(0.1));
    });
    expect(
      useComposerDraftStore.getState().getDraftSession(DraftId.make("first"))
        ?.loadBalancedEnvironmentId ?? null,
    ).toBeNull();
  },
);
