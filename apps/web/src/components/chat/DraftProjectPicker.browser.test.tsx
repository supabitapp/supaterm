import { EnvironmentId, ProjectId, type ScopedProjectRef } from "@supaterm/contracts";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@supaterm/contracts/settings";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { DraftId } from "../../draftId";
import { DraftProjectPicker } from "./DraftProjectPicker";

const fixtures = vi.hoisted(() => ({
  projects: [] as EnvironmentProject[],
  primary: null as EnvironmentId | null,
  roots: new Map<EnvironmentId, string>(),
  openScratch: vi.fn<(environmentId: EnvironmentId) => Promise<null>>(),
}));

vi.mock("~/state/entities", () => ({
  useProjects: () => fixtures.projects,
  useThreadShells: () => [],
  readThreadShells: () => [],
  readProject: (ref: ScopedProjectRef) =>
    fixtures.projects.find(
      (project) => project.environmentId === ref.environmentId && project.id === ref.projectId,
    ),
}));
vi.mock("~/state/environments", () => ({
  usePrimaryEnvironmentId: () => fixtures.primary,
  useEnvironments: () => ({
    environments: [...fixtures.roots.keys()].map((environmentId) => ({
      environmentId,
      label: environmentId,
      serverConfig: null,
    })),
  }),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: <T,>(select: (settings: ClientSettings) => T) =>
    select(DEFAULT_CLIENT_SETTINGS),
}));
vi.mock("~/hooks/useScratchProject", () => ({
  useScratchProject: () => ({
    scratchEnvironmentId: () => fixtures.primary,
    scratchWorkspaceRootFor: (environmentId: EnvironmentId | null) =>
      environmentId === null ? null : (fixtures.roots.get(environmentId) ?? null),
    openScratchProject: fixtures.openScratch,
  }),
}));
vi.mock("~/hooks/useHandleNewThread", () => ({
  useNewThreadHandler: () => async () => null,
}));
vi.mock("../ProjectFavicon", () => ({ ProjectFavicon: () => null }));
vi.mock(import("~/state/server"), async (original) => {
  const server = await original();
  const { Atom } = await import("effect/reactivity");
  const { DEFAULT_RESOLVED_KEYBINDINGS } = await import("@supaterm/shared/keybindings");
  return {
    ...server,
    primaryServerKeybindingsAtom: Atom.make(DEFAULT_RESOLVED_KEYBINDINGS),
  };
});

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");

function setup(remoteRoot: string) {
  fixtures.primary = local;
  fixtures.roots = new Map([
    [local, "/local/scratch"],
    [remote, "/remote/scratch"],
  ]);
  fixtures.openScratch.mockReset().mockResolvedValue(null);
  const project: EnvironmentProject = {
    environmentId: remote,
    id: ProjectId.make("remote-project"),
    title: "Remote workspace",
    workspaceRoot: remoteRoot,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-10-29T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
    scripts: [],
  };
  fixtures.projects = [project];
  return project;
}

function Picker({ project }: { project: EnvironmentProject }) {
  return (
    <DraftProjectPicker
      draftId={DraftId.make("scratch-classification")}
      activeProjectRef={scopeProjectRef(project.environmentId, project.id)}
      activeProjectTitle={project.title}
      isSendInFlight={() => false}
    />
  );
}

it("recognizes the active remote scratch root while the primary machine has a different root", async () => {
  const project = setup("/remote/scratch");
  await using screen = await render(<Picker project={project} />);
  const trigger = screen.getByRole("combobox", { name: "Project: No project" });
  await expect.element(trigger).toBeVisible();
  await trigger.click();
  const option = page.getByRole("option", { name: /No project/ });
  await expect.element(option).toHaveAttribute("aria-selected", "true");
  await option.click();
  expect(fixtures.openScratch).not.toHaveBeenCalled();
});

it("does not mistake a remote project at the primary root path for remote scratch", async () => {
  const project = setup("/local/scratch");
  await using screen = await render(<Picker project={project} />);
  await expect
    .element(screen.getByRole("combobox", { name: "Project: Remote workspace" }))
    .toBeVisible();
});

it("keeps the primary environment as the destination when choosing No project", async () => {
  const project = setup("/remote/repository");
  await using screen = await render(<Picker project={project} />);
  await screen.getByRole("combobox", { name: "Project: Remote workspace" }).click();
  await page.getByRole("option", { name: /No project/ }).click();
  expect(fixtures.openScratch).toHaveBeenCalledExactlyOnceWith(local);
});
