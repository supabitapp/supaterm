import type { NavigationState } from "@react-navigation/native";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  dispatch: vi.fn(),
  setText: vi.fn(),
  updateSettings: vi.fn(),
  notice: vi.fn(),
  navigation: undefined as NavigationState | undefined,
}));

vi.mock("@react-navigation/native", () => ({
  StackActions: {
    push: (name: string, params: object) => ({ type: "PUSH", payload: { name, params } }),
  },
}));
vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../../lib/rootNavigation", () => ({
  rootNavigationRef: { getRootState: () => state.navigation, dispatch: state.dispatch },
}));
vi.mock("../../state/projects", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentProjects: {
      projectsAtom: Atom.make([
        {
          id: "project",
          environmentId: "environment",
          title: "Repository",
          repositoryIdentity: {
            canonicalKey: "github.com/owner/repo",
            locator: { source: "git-remote", remoteName: "origin", remoteUrl: "" },
          },
        },
      ]),
    },
    projectEnvironment: {},
  };
});
vi.mock("../../state/server", async () => {
  const { Atom } = await import("effect/reactivity");
  const { DEFAULT_SERVER_SETTINGS } = await import("@supaterm/contracts");
  return {
    environmentServerConfigsAtom: Atom.make(
      new Map([
        [
          "environment",
          {
            settings: {
              ...DEFAULT_SERVER_SETTINGS,
              providerInstances: {
                global: { driver: "codex", enabled: true, config: {} },
                project: { driver: "codex", enabled: false, config: {} },
              },
              projectSettingsOverrides: {
                project: {
                  providerInstances: { global: { enabled: false }, project: { enabled: true } },
                },
              },
            },
            providers: [
              { instanceId: "global", enabled: true },
              { instanceId: "project", enabled: false },
            ].map((instance) => ({
              ...instance,
              driver: "codex",
              availability: "available",
              status: "ready",
              models: [{ slug: "requested", name: "Requested", isDefault: true }],
            })),
          },
        ],
      ]),
    ),
  };
});
vi.mock("../../state/threads", async () => {
  const { Atom } = await import("effect/reactivity");
  return { environmentThreadShells: { threadShellsAtom: Atom.make([]) } };
});
vi.mock("../../state/workspace", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    workspaceStateAtom: Atom.make({
      isLoadingConnections: false,
      hasPendingShellSnapshot: false,
      connectingEnvironments: [],
    }),
    workspaceConnections: { environmentsAtom: Atom.make([]) },
  };
});
vi.mock("../../state/pull-requests", () => ({ composerPullRequests: {} }));
vi.mock("../../state/use-composer-drafts", () => ({
  createNewTaskDraft: () => "draft",
  setComposerDraftText: state.setText,
  updateComposerDraftSettings: state.updateSettings,
  waitForComposerDraftsLoaded: () => Promise.resolve(),
}));
vi.mock("./prompt-link-actions", () => ({
  applyLinkedPromptToThreadDraft: vi.fn(),
  showPromptLinkNotice: state.notice,
}));

import { resolvePendingNewTaskPromptLink, takeNewTaskPromptLink } from "./newTaskPromptLink";

it("opens a linked draft with the project-enabled provider rather than the machine default", async () => {
  state.navigation = {
    key: "root",
    type: "stack",
    stale: false,
    index: 0,
    routeNames: ["NewTaskProject"],
    routes: [
      {
        key: "new",
        name: "NewTaskProject",
        params: {
          repo: "owner/repo",
          prompt: "Review this",
          provider: "codex",
          model: "requested",
        },
      },
    ],
  };
  takeNewTaskPromptLink({ routes: state.navigation.routes });
  resolvePendingNewTaskPromptLink(state.navigation);
  await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalled());
  expect(state.setText).toHaveBeenCalledWith("draft", "Review this");
  expect(state.updateSettings).toHaveBeenCalledWith("draft", {
    modelSelection: { instanceId: "project", model: "requested" },
  });
  expect(state.notice).toHaveBeenCalledWith(
    "This prompt came from a link. Read it before you send.",
  );
});
