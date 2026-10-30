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
  envLocked = false,
  providerAvailable = true,
  projectScope,
  sendRef,
}: {
  scope?: string;
  automatic?: boolean;
  sendInFlight?: boolean;
  attachments?: boolean;
  envLocked?: boolean;
  providerAvailable?: boolean;
  projectScope?: string;
  sendRef?: { current: boolean };
}) {
  const draftId = DraftId.make(scope);
  const draftThread = useComposerDraftStore((state) => state.getDraftSession(draftId));
  const activeProviderInstanceId = useComposerDraftStore(
    (state) => state.getComposerDraft(draftId)?.activeProvider ?? null,
  );
  const storedAttachments = useComposerDraftStore((state) => {
    const draft = state.getComposerDraft(draftId);
    return (draft?.images.length ?? 0) > 0 || (draft?.files.length ?? 0) > 0;
  });
  const routing = useDraftEnvironmentRouting({
    draftId,
    draftThread,
    envLocked,
    automaticEnvironment:
      automatic &&
      draftThread?.environmentSelection !== "manual" &&
      !attachments &&
      !storedAttachments &&
      !envLocked,
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
    providersByEnvironment: providerAvailable ? providersByEnvironment : new Map(),
    loadBalancingSettings: { loadBalancingWeights: {} },
    referencedThreadContexts: [],
    activeProviderInstanceId,
    selectedProvider: provider.driver,
    composerHasAttachments: attachments || storedAttachments,
    activeProjectKey: projectScope ?? scope,
    activeProjectIsScratch: false,
    projectGroupingSettings: {
      sidebarProjectGroupingMode: "repository",
      sidebarProjectGroupingOverrides: {},
    },
    sendInFlightRef: sendRef ?? { current: sendInFlight },
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

it("a same-turn stored attachment blocks an automatic completion", async () => {
  using test = setup();
  await using _screen = await render(
    <RegistryContext value={test.registry}>
      <Routing automatic />
    </RegistryContext>,
    { router: false },
  );
  await act(() => {
    test.registry.set(resources.get(originalEnvironmentId)!, ready(0.8));
    test.registry.set(resources.get(targetEnvironmentId)!, ready(0.1));
    useComposerDraftStore.getState().addImage(DraftId.make("first"), {
      type: "image",
      id: "attachment",
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 1,
      previewUrl: "data:image/png;base64,AA==",
      file: new File(["x"], "image.png", { type: "image/png" }),
    });
  });
  expect(
    useComposerDraftStore.getState().getComposerDraft(DraftId.make("first"))?.images,
  ).toHaveLength(1);
  expect(
    useComposerDraftStore.getState().getDraftSession(DraftId.make("first"))
      ?.loadBalancedEnvironmentId ?? null,
  ).toBeNull();
});

it("a same-turn provider change blocks an automatic completion", async () => {
  using test = setup();
  await using _screen = await render(
    <RegistryContext value={test.registry}>
      <Routing automatic />
    </RegistryContext>,
    { router: false },
  );
  await act(() => {
    test.registry.set(resources.get(originalEnvironmentId)!, ready(0.8));
    test.registry.set(resources.get(targetEnvironmentId)!, ready(0.1));
    useComposerDraftStore.getState().setModelSelection(DraftId.make("first"), {
      instanceId: ProviderInstanceId.make("other"),
      model: "other-model",
    });
  });
  expect(
    useComposerDraftStore.getState().getDraftSession(DraftId.make("first"))
      ?.loadBalancedEnvironmentId ?? null,
  ).toBeNull();
});

it("a same-turn file attachment blocks an automatic completion", async () => {
  using test = setup();
  await using _screen = await render(
    <RegistryContext value={test.registry}>
      <Routing automatic />
    </RegistryContext>,
    { router: false },
  );
  await act(() => {
    test.registry.set(resources.get(originalEnvironmentId)!, ready(0.8));
    test.registry.set(resources.get(targetEnvironmentId)!, ready(0.1));
    useComposerDraftStore.getState().addFiles(DraftId.make("first"), [
      {
        type: "file",
        id: "file",
        name: "context.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        file: new File(["x"], "context.txt", { type: "text/plain" }),
      },
    ]);
  });
  expect(
    useComposerDraftStore.getState().getComposerDraft(DraftId.make("first"))?.files,
  ).toHaveLength(1);
  expect(
    useComposerDraftStore.getState().getDraftSession(DraftId.make("first"))
      ?.loadBalancedEnvironmentId ?? null,
  ).toBeNull();
});

it("a live send flag blocks an already queued completion", async () => {
  using test = setup();
  const sendRef = { current: false };
  await using _screen = await render(
    <RegistryContext value={test.registry}>
      <Routing automatic sendRef={sendRef} />
    </RegistryContext>,
    { router: false },
  );
  await act(() => {
    test.registry.set(resources.get(originalEnvironmentId)!, ready(0.8));
    test.registry.set(resources.get(targetEnvironmentId)!, ready(0.1));
    sendRef.current = true;
  });
  expect(
    useComposerDraftStore.getState().getDraftSession(DraftId.make("first"))
      ?.loadBalancedEnvironmentId ?? null,
  ).toBeNull();
});

it("unmounting while host completion is queued discards the choice", async () => {
  using test = setup();
  await using screen = await render(
    <RegistryContext value={test.registry}>
      <Routing automatic />
    </RegistryContext>,
    { router: false },
  );
  await act(async () => {
    test.registry.set(resources.get(originalEnvironmentId)!, ready(0.8));
    test.registry.set(resources.get(targetEnvironmentId)!, ready(0.1));
    await screen.unmount();
  });
  expect(
    useComposerDraftStore.getState().getDraftSession(DraftId.make("first"))
      ?.loadBalancedEnvironmentId ?? null,
  ).toBeNull();
});

it("changing scope while host completion is queued discards the old choice", async () => {
  using test = setup();
  await using screen = await render(
    <RegistryContext value={test.registry}>
      <Routing automatic />
    </RegistryContext>,
    { router: false },
  );
  await act(async () => {
    test.registry.set(resources.get(originalEnvironmentId)!, ready(0.8));
    test.registry.set(resources.get(targetEnvironmentId)!, ready(0.1));
    await screen.rerender(
      <RegistryContext value={test.registry}>
        <Routing scope="second" />
      </RegistryContext>,
    );
  });
  expect(
    useComposerDraftStore.getState().getDraftSession(DraftId.make("first"))
      ?.loadBalancedEnvironmentId ?? null,
  ).toBeNull();
});

it.each(["environment lock", "provider availability"] as const)(
  "a committed %s change revokes queued routing delivery",
  async (change) => {
    using test = setup();
    await using screen = await render(
      <RegistryContext value={test.registry}>
        <Routing automatic />
      </RegistryContext>,
      { router: false },
    );
    await act(async () => {
      test.registry.set(resources.get(originalEnvironmentId)!, ready(0.8));
      test.registry.set(resources.get(targetEnvironmentId)!, ready(0.1));
      await screen.rerender(
        <RegistryContext value={test.registry}>
          <Routing
            automatic
            envLocked={change === "environment lock"}
            providerAvailable={change !== "provider availability"}
          />
        </RegistryContext>,
      );
    });
    expect(
      useComposerDraftStore.getState().getDraftSession(DraftId.make("first"))
        ?.loadBalancedEnvironmentId ?? null,
    ).toBeNull();
  },
);
