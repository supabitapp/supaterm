import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AuthOrchestrationOperateScope, AuthSourceControlWriteScope } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  scopes: new Set<string>(),
  otherScopes: new Set<string>(),
  baseDirectory: "",
  projects: [] as string[],
  createRequests: [] as { environmentId: string; workspaceRoot: string }[],
  dispatch: vi.fn(),
  navigationState: { index: 0, routes: [{ key: "home", name: "Home" }] } as {
    index: number;
    routes: ReadonlyArray<{ key: string; name: string; params?: unknown }>;
  },
  waitForProject: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}],
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
}));
vi.mock("../../components/ui/NavigationRow", () => ({ NavigationRow: "NavigationRow" }));
vi.mock("../../components/ui/Button", () => ({ Button: "Button" }));
vi.mock("../../components/ui/ScreenScrollView", () => ({ ScreenScrollView: "ScrollView" }));
vi.mock("../settings/components/SettingsScreen", () => ({ SettingsScreen: "SettingsScreen" }));
vi.mock("../../components/ui/ThemedSwitch", () => ({ ThemedSwitch: "Switch" }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: () => {} },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    dispatch: state.dispatch,
    getState: () => state.navigationState,
  }),
  CommonActions: { reset: (input: unknown) => input },
  StackActions: {},
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: "SymbolView" }));
vi.mock("../../components/ui/AppText", () => ({ AppText: "Text", AppTextInput: "TextInput" }));
vi.mock("../../components/EnvironmentMachineSymbol", () => ({
  EnvironmentMachineSymbol: "EnvironmentMachineSymbol",
}));
vi.mock("../../components/ui/ErrorBanner", () => ({ ErrorBanner: "ErrorBanner" }));
vi.mock("./SourceControlIcon", () => ({ SourceControlIcon: "SourceControlIcon" }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "project" }));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: (environmentId: string, scope: string) =>
    (environmentId === "environment" ? state.scopes : state.otherScopes).has(scope),
  readEnvironmentScope: (environmentId: string, scope: string) =>
    (environmentId === "environment" ? state.scopes : state.otherScopes).has(scope),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => [],
  waitForProject: () => state.waitForProject(),
  useServerConfigs: () =>
    new Map([
      [
        "environment",
        {
          environment: { platform: { os: "linux" }, capabilities: {} },
          settings: { addProjectBaseDirectory: state.baseDirectory },
        },
      ],
      [
        "other-environment",
        {
          environment: { platform: { os: "linux" }, capabilities: {} },
          settings: { addProjectBaseDirectory: state.baseDirectory },
        },
      ],
    ]),
}));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useRemoteEnvironmentRuntime: () => ({ connectionState: "connected" }),
  useRemoteConnectionStatus: () => ({
    connectedEnvironments: [
      { environmentId: "environment", connectionState: "connected" },
      { environmentId: "other-environment", connectionState: "connected" },
    ],
  }),
  useSavedRemoteConnections: () => ({
    savedConnectionsById: {
      connection: { environmentId: "environment", environmentLabel: "Environment" },
      other: { environmentId: "other-environment", environmentLabel: "Other environment" },
    },
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => () => {} }));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({ isReady: true, presentation: null }),
}));
vi.mock("../../state/filesystem", () => ({ filesystemEnvironment: {} }));
vi.mock("../../state/sourceControl", () => ({
  sourceControlEnvironment: {
    startProjectClone: async ({ input }: { input: { destinationPath: string } }) => {
      NodeFS.mkdirSync(input.destinationPath);
      state.projects.push(input.destinationPath);
      return AsyncResult.success(undefined);
    },
  },
}));
vi.mock("../../state/projects", () => ({
  projectEnvironment: {
    create: async ({
      environmentId,
      input,
    }: {
      environmentId: string;
      input: { workspaceRoot: string };
    }) => {
      state.createRequests.push({ environmentId, workspaceRoot: input.workspaceRoot });
      const scopes = environmentId === "environment" ? state.scopes : state.otherScopes;
      if (!scopes.has(AuthOrchestrationOperateScope)) {
        return AsyncResult.failure(Cause.fail(new Error("Project creation denied")));
      }
      state.projects.push(input.workspaceRoot);
      return AsyncResult.success(undefined);
    },
  },
}));

import { AddProjectDestinationScreen } from "./AddProjectScreen";

function findAction(node: ReactNode, label: string): (() => unknown) | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const action = findAction(child, label);
      if (action) return action;
    }
    return null;
  }
  if (!isValidElement<{ label?: string; onPress?: () => unknown; children?: ReactNode }>(node)) {
    return null;
  }
  if (node.props.label === label) return node.props.onPress ?? null;
  return findAction(node.props.children, label);
}

function cloneAction() {
  const action = findAction(
    AddProjectDestinationScreen({
      environmentId: "environment",
      remoteUrl: "https://example.com/repo.git",
      repositoryName: "repo",
    }),
    "Clone project",
  );
  if (!action) throw new Error("Clone action missing");
  return action;
}

describe("clone project permissions", () => {
  beforeEach(async () => {
    state.baseDirectory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "supaterm-clone-permissions-"),
    );
    state.scopes = new Set([AuthSourceControlWriteScope]);
    state.otherScopes = new Set();
    state.projects = [];
    state.createRequests = [];
    state.dispatch.mockReset();
    state.navigationState = { index: 0, routes: [{ key: "home", name: "Home" }] };
    state.waitForProject.mockReset();
    state.waitForProject.mockResolvedValue(null);
  });

  afterEach(async () => {
    await NodeFSP.rm(state.baseDirectory, { recursive: true, force: true });
  });

  it("does not leave a clone on disk when project creation is denied", async () => {
    await cloneAction()();

    expect(NodeFS.existsSync(NodePath.join(state.baseDirectory, "repo"))).toBe(false);
    expect(state.projects).toEqual([]);
  });

  it.each([AuthSourceControlWriteScope, AuthOrchestrationOperateScope])(
    "rechecks %s before a retained clone action creates a directory",
    async (scope) => {
      state.scopes.add(AuthOrchestrationOperateScope);
      const submit = cloneAction();
      state.scopes.delete(scope);
      await submit();

      expect(NodeFS.existsSync(NodePath.join(state.baseDirectory, "repo"))).toBe(false);
      expect(state.projects).toEqual([]);
    },
  );

  it("opens the cloned project's draft from the screen that started the clone", async () => {
    state.scopes.add(AuthOrchestrationOperateScope);
    state.waitForProject.mockResolvedValue({ id: "project" });
    await cloneAction()();

    const reset = state.dispatch.mock.calls.at(-1)?.[0] as {
      routes: ReadonlyArray<{ name: string; params?: { draft?: { projectId?: string } } }>;
    };
    expect(reset.routes.at(-1)?.name).toBe("Thread");
    expect(reset.routes.at(-1)?.params?.draft?.projectId).toBe("project");
  });

  it("leaves navigation alone when the user moved on while the project arrived", async () => {
    state.scopes.add(AuthOrchestrationOperateScope);
    state.waitForProject.mockImplementation(async () => {
      state.navigationState = { index: 0, routes: [{ key: "settings", name: "Settings" }] };
      return { id: "project" };
    });
    await cloneAction()();

    expect(state.dispatch).not.toHaveBeenCalled();
  });
});
