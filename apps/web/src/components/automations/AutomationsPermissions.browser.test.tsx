import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTask,
} from "@supaterm/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

const state = vi.hoisted(() => ({
  environments: [] as Array<Record<string, unknown>>,
  projects: [] as Array<Record<string, unknown>>,
  permissions: new Set<string>(),
  tasks: new Map<string, ScheduledTask[]>(),
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  upsert: vi.fn(),
  toggle: vi.fn(),
  run: vi.fn(),
  remove: vi.fn(),
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  getRouteApi: (() => ({
    useSearch: () => state.search,
    useNavigate: () => state.navigate,
  })) as never,
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: state.environments })) as never,
  usePrimaryEnvironmentId: (() => state.environments[0]?.environmentId ?? null) as never,
  useEnvironment: ((environmentId: string) =>
    state.environments.find((environment) => environment.environmentId === environmentId) ??
    null) as never,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: ((environmentId: string | null, scope: string) =>
    scope === AuthOrchestrationOperateScope &&
    environmentId !== null &&
    state.permissions.has(environmentId)) as never,
  readEnvironmentScope: ((environmentId: string, scope: string) =>
    scope === AuthOrchestrationOperateScope && state.permissions.has(environmentId)) as never,
  useEnvironmentsWithScope: ((environments: Array<{ environmentId: string }>, scope: string) =>
    new Set(
      environments.flatMap(({ environmentId }) =>
        scope === AuthOrchestrationOperateScope && state.permissions.has(environmentId)
          ? [environmentId]
          : [],
      ),
    )) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => state.projects) as never,
  useThreadShell: () => null,
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((query: { environmentId: string } | null) => ({
    data: query === null ? null : { tasks: state.tasks.get(query.environmentId) ?? [] },
    error: null,
  })) as never,
}));
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providersValueAtom: () => "providers",
      scheduledTasksLive: ({ environmentId }: { environmentId: string }) => ({ environmentId }),
      upsertScheduledTask: "upsert",
      setScheduledTaskEnabled: "toggle",
      runScheduledTaskNow: "run",
      deleteScheduledTask: "remove",
    } as never,
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: string) =>
    ({ upsert: state.upsert, toggle: state.toggle, run: state.run, remove: state.remove })[
      command as "upsert" | "toggle" | "run" | "remove"
    ]) as never,
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: (() => DEFAULT_SERVER_SETTINGS) as never,
}));
vi.mock(import("../settings/useSettingsProjectGroups"), async (original) => ({
  ...(await original()),
  useSettingsProjectGroups: () => [],
}));
vi.mock(import("../../hooks/useNowMinute"), async (original) => ({
  ...(await original()),
  useNowMinuteMs: () => Date.parse("2026-10-07T12:00:00Z"),
}));
vi.mock(import("@effect/atom-react"), async (original) => {
  const { AsyncResult } = await import("effect/reactivity");
  return {
    ...(await original()),
    useAtomValue: ((atom: {
      read?: (get: (query: { environmentId: string }) => unknown) => unknown;
    }) =>
      typeof atom?.read === "function"
        ? atom.read(({ environmentId }) =>
            AsyncResult.success({ tasks: state.tasks.get(environmentId) ?? [] }),
          )
        : []) as never,
  };
});
// Pickers and icons that read live provider and git state are out of scope here.
vi.mock(import("../EnvironmentMachineIcon"), async (original) => ({
  ...(await original()),
  EnvironmentMachineIcon: (() => null) as never,
}));
vi.mock(import("../WorktreeBaseBranchPicker"), async (original) => ({
  ...(await original()),
  WorktreeBaseBranchPicker: (() => null) as never,
}));
vi.mock(import("../chat/ProviderModelPicker"), async (original) => ({
  ...(await original()),
  ProviderModelPicker: (() => null) as never,
}));
vi.mock(import("../settings/ScopeSentence"), async (original) => ({
  ...(await original()),
  ScopeSentence: (() => null) as never,
}));
vi.mock(import("../ui/sidebar"), async (original) => ({
  ...(await original()),
  SidebarInset: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));

import { pressAgain } from "~/test/inlineConfirm";
import { AutomationsPage } from "./AutomationsPage";
import { AutomationEditorDialog } from "./AutomationEditorDialog";
import type { EnvironmentPresentation } from "../../state/environments";
import type { ResolvedSettingsScope } from "../settings/settingsScope";

const primaryId = EnvironmentId.make("primary");
const remoteId = EnvironmentId.make("remote");
const primaryProjectId = ProjectId.make("project-primary");
const remoteProjectId = ProjectId.make("project-remote");
const taskId = ScheduledTaskId.make("task");
const instanceId = ProviderInstanceId.make("codex");

const environment = (environmentId: EnvironmentId, label: string) => ({
  environmentId,
  label,
  connection: { phase: "connected" },
  serverConfig: {
    settings: DEFAULT_SERVER_SETTINGS,
    environment: { platform: { machine: "server" } },
  },
});

const task = (projectId: ProjectId): ScheduledTask =>
  ({
    id: taskId,
    title: "Read only automation",
    prompt: "Review recent changes",
    enabled: true,
    schedule: { type: "interval", everyMs: 900_000 },
    projectId,
    threadId: null,
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId, model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    lastRunStatus: "never",
    lastRunAt: null,
    lastRunError: null,
    nextRunAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    runCount: 0,
  }) as ScheduledTask;

const scope: ResolvedSettingsScope = {
  kind: "all",
  label: "All environments",
  members: [],
  environmentIds: [primaryId, remoteId],
};

// Dialogs and menus render in a portal, so the whole document is searched.
const pageText = () => document.body.textContent ?? "";
const buttonNamed = (label: string) =>
  [...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find((button) =>
    button.textContent?.includes(label),
  );
const byLabel = (label: string) =>
  document.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`);
const environmentSelect = () => document.getElementById("scheduled-task-environment");
const click = (element: HTMLElement) => act(async () => element.click());

describe("automation permissions", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.environments = [environment(primaryId, "Local"), environment(remoteId, "Remote")];
    state.projects = [
      {
        id: primaryProjectId,
        environmentId: primaryId,
        title: "Local project",
        workspaceRoot: "/local",
      },
      {
        id: remoteProjectId,
        environmentId: remoteId,
        title: "Remote project",
        workspaceRoot: "/remote",
      },
    ];
    state.permissions = new Set([primaryId, remoteId]);
    state.tasks = new Map();
    state.search = {};
    state.navigate.mockReset();
    state.upsert.mockReset().mockResolvedValue({ _tag: "Success" });
    state.toggle.mockReset().mockResolvedValue({ _tag: "Success" });
    state.run.mockReset().mockResolvedValue({ _tag: "Success" });
    state.remove.mockReset().mockResolvedValue({ _tag: "Success" });
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  const renderPage = () => act(async () => root.render(<AutomationsPage />));

  it("creates in a writable connected environment when the default is read-only", async () => {
    state.permissions = new Set([remoteId]);
    await renderPage();

    const createButton = buttonNamed("New automation") as HTMLButtonElement;
    expect(createButton.disabled).toBe(false);
    await click(createButton);

    expect(environmentSelect()?.textContent).toContain("Remote");
  });

  it("creates from an empty environment and rechecks its grant before opening", async () => {
    state.permissions = new Set([remoteId]);
    await renderPage();

    expect(byLabel("Create automation on Local")).toHaveLength(0);
    const createButton = byLabel("Create automation on Remote")[0]!;
    state.permissions.delete(remoteId);
    await click(createButton);
    expect(environmentSelect()).toBeNull();

    state.permissions.add(remoteId);
    await click(createButton);
    expect(environmentSelect()?.textContent).toContain("Remote");
  });

  it("opens a read-only editor for a deep-linked task without enabling edits", async () => {
    const existing = task(primaryProjectId);
    state.tasks.set(primaryId, [existing]);
    state.permissions.delete(primaryId);
    state.search = { environmentId: primaryId, taskId };

    await renderPage();

    expect(pageText()).toContain("Edit automation");
    expect(pageText()).toContain("This connection does not have permission to manage automations.");
    expect(document.querySelector("fieldset")?.disabled).toBe(true);
    expect((buttonNamed("Save automation") as HTMLButtonElement).disabled).toBe(true);
  });

  it("rechecks permission at submit after access is revoked while the editor is open", async () => {
    const existing = task(remoteProjectId);
    state.tasks.set(remoteId, [existing]);
    const connectedEnvironments = [state.environments[1] as unknown as EnvironmentPresentation];
    const dialog = () => (
      <AutomationEditorDialog
        initialEnvironmentId={remoteId}
        task={existing}
        scope={scope}
        connectedEnvironments={connectedEnvironments}
        onClose={vi.fn()}
      />
    );

    await act(async () => root.render(dialog()));

    const saveButton = buttonNamed("Save automation") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
    state.permissions.delete(remoteId);
    await click(saveButton);

    expect(state.upsert).not.toHaveBeenCalled();
    await act(async () => root.render(dialog()));
    expect(document.querySelector("fieldset")?.disabled).toBe(true);
    expect((buttonNamed("Save automation") as HTMLButtonElement).disabled).toBe(true);
  });

  it("rechecks permission before a retained edit action opens the editor", async () => {
    state.tasks.set(remoteId, [task(remoteProjectId)]);
    await renderPage();
    await click(byLabel("Actions for Read only automation")[0]!);
    const edit = buttonNamed("Edit");
    expect(edit).toBeDefined();

    state.permissions.delete(remoteId);
    await click(edit!);

    expect(pageText()).not.toContain("Edit automation");
  });

  it("folds environments without automations into one line", async () => {
    state.tasks.set(remoteId, [task(remoteProjectId)]);
    await renderPage();

    expect(byLabel("Remote")).toHaveLength(1);
    expect(byLabel("Local")).toHaveLength(0);
    expect(pageText()).toContain("No automations on Local");
  });

  it("lists a single environment's automations and flags a link it does not have", async () => {
    state.environments = [environment(remoteId, "Remote")];
    state.tasks.set(remoteId, [task(remoteProjectId)]);
    state.search = { environmentId: remoteId, taskId: ScheduledTaskId.make("missing") };
    await renderPage();

    expect(pageText()).toContain("Read only automation");
    expect(pageText()).toContain("Automation unavailable");
    expect(pageText()).not.toContain("Edit automation");
  });

  it("blocks retained row actions after the environment grant is revoked", async () => {
    state.tasks.set(remoteId, [task(remoteProjectId)]);
    await renderPage();
    const toggle = byLabel("Pause Read only automation")[0]!;
    const openActions = () => click(byLabel("Actions for Read only automation")[0]!);

    await openActions();
    expect(buttonNamed("Run now")).toBeDefined();
    await click(buttonNamed("Delete")!);
    state.permissions.delete(remoteId);

    await click(toggle);
    await pressAgain(buttonNamed("Confirm delete")!);
    if (!buttonNamed("Run now")) await openActions();
    await click(buttonNamed("Run now")!);

    expect(state.toggle).not.toHaveBeenCalled();
    expect(state.run).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
});
