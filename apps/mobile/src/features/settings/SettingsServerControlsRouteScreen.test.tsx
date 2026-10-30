import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type OrchestrationSkillsStatus,
  type ServerSettingsPatch,
} from "@supaterm/contracts";
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { Children, mocks } = vi.hoisted(() => ({
  Children: ({ children }: { children?: ReactNode }) => children,
  mocks: {
    branchNaming: { onChange: (_patch: ServerSettingsPatch) => {} },
    updateSettings: vi.fn(),
    alert: vi.fn(),
    targets: [] as ReturnType<typeof environment>[],
    projectSelected: false,
    permissions: new Set<string>(),
    installed: new Map<string, boolean>(),
    skillsStatus: vi.fn(),
    skillsInstall: vi.fn(),
    skillsUninstall: vi.fn(),
    commands: { settings: {}, status: {}, install: {}, uninstall: {} },
    targetListeners: new Set<() => void>(),
  },
}));

vi.mock("react-native", () => ({
  View: Children,
  Alert: { alert: mocks.alert },
  Pressable: ({
    children,
    disabled,
    onPress,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onPress: () => void;
    accessibilityLabel?: string;
  }) => (
    <button disabled={disabled} onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
}));
vi.mock("./components/AutoMarkDoneDaysField", () => ({ AutoMarkDoneDaysField: () => null }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({}) }));
vi.mock("../../state/session", () => ({
  readEnvironmentScope: (environmentId: string) => mocks.permissions.has(environmentId),
  useEnvironmentsWithScope: () => new Set(mocks.permissions),
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    updateSettings: mocks.commands.settings,
    orchestrationSkillsStatus: mocks.commands.status,
    orchestrationSkillsInstall: mocks.commands.install,
    orchestrationSkillsUninstall: mocks.commands.uninstall,
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === mocks.commands.status
      ? mocks.skillsStatus
      : command === mocks.commands.install
        ? mocks.skillsInstall
        : command === mocks.commands.uninstall
          ? mocks.skillsUninstall
          : mocks.updateSettings,
}));
vi.mock("../threads/thread-settings-options", () => ({ RUNTIME_MODE_CHOICES: [] }));
vi.mock("../../components/ui/ScreenScrollView", () => ({ ScreenScrollView: Children }));
vi.mock("../../components/ui/AppText", () => ({ AppText: Children }));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("./components/SettingsScreen", () => ({ SettingsScreen: Children }));
vi.mock("./components/SettingsEnvironmentFilterHeader", () => ({
  AndroidSettingsEnvironmentFilter: () => null,
  SettingsEnvironmentFilterHeader: () => null,
}));
vi.mock("./components/DatabaseStorageNotice", () => ({ DatabaseStorageNotice: () => null }));
vi.mock("./components/SettingsSection", () => ({ SettingsSection: Children }));
vi.mock("../../components/ui/ListChoiceRow", () => ({ ListChoiceRow: () => null }));
vi.mock("./components/SourceControlSignInSection", () => ({
  SourceControlSignInSection: () => null,
}));
vi.mock("./components/SettingsProjectOverridesSection", () => ({
  SettingsProjectOverridesSection: () => null,
}));
vi.mock("./ThreadSettingsSections", () => ({ AutoMarkDoneSettingsRows: () => null }));
vi.mock("./components/SettingsSwitchRow", () => ({
  SettingsSwitchRow: ({
    label,
    value,
    disabled,
    onValueChange,
  }: {
    label: string;
    value: boolean | null;
    disabled?: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <button
      role="switch"
      aria-checked={value ?? "mixed"}
      disabled={disabled}
      onClick={() => onValueChange(!value)}
    >
      {label}
    </button>
  ),
}));
vi.mock("./components/SettingsRow", () => ({
  SettingsRow: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("./components/BranchNamingSettings", () => ({
  BranchNamingSettings: (props: { onChange: (patch: ServerSettingsPatch) => void }) => {
    mocks.branchNaming.onChange = props.onChange;
    return null;
  },
}));
vi.mock("./settings-environment-filter", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSettingsEnvironmentFilter: () => {
      const selectedTargets = useSyncExternalStore(
        (listener) => {
          mocks.targetListeners.add(listener);
          return () => mocks.targetListeners.delete(listener);
        },
        () => mocks.targets,
      );
      return {
        selectedTargets,
        projectGroups: [
          {
            key: "project",
            label: "Project",
            members: selectedTargets.map((target) => ({
              project: { environmentId: target.environmentId, id: "project" },
            })),
          },
        ],
        selectedProjectKey: mocks.projectSelected ? "project" : null,
      };
    },
  };
});

import {
  SettingsThreadsRouteScreen,
  SettingsWorktreesRouteScreen,
} from "./SettingsServerControlsRouteScreen";

function environment(environmentId: string, label: string) {
  return {
    environmentId: EnvironmentId.make(environmentId),
    label,
    connection: { phase: "connected" },
    serverConfig: {
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        defaultAutoPull: false,
        sidebarAutoMarkDoneOnMerge: false,
      },
      environment: {
        capabilities: {},
      },
    },
  };
}

let root: Root;
let container: HTMLDivElement;
let registry: AtomRegistry.AtomRegistry;

function render(screen: ReactNode) {
  root.render(<RegistryContext.Provider value={registry}>{screen}</RegistryContext.Provider>);
}

function skillsStatus(installed: boolean): OrchestrationSkillsStatus {
  return {
    targets: [
      {
        directory: "/skills",
        providers: ["Codex"],
        skills: [
          {
            name: "supaterm-advisor",
            state: installed ? "installed" : "not-installed",
            managed: installed,
          },
        ],
      },
    ],
    unsupportedProviders: [],
  };
}

function button(label: string) {
  const element = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  expect(element).toBeDefined();
  return element!;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
  registry = AtomRegistry.make();
  mocks.targets = [environment("local", "Local")];
  mocks.projectSelected = false;
  mocks.alert.mockReset();
  mocks.updateSettings.mockReset();
  mocks.updateSettings.mockResolvedValue(AsyncResult.success(undefined));
  mocks.permissions.clear();
  mocks.permissions.add("local");
  mocks.installed.clear();
  mocks.skillsStatus
    .mockReset()
    .mockImplementation(async ({ environmentId }: { environmentId: string }) =>
      AsyncResult.success(skillsStatus(mocks.installed.get(environmentId) ?? false)),
    );
  for (const [command, installed] of [
    [mocks.skillsInstall, true],
    [mocks.skillsUninstall, false],
  ] as const) {
    command.mockReset().mockImplementation(async ({ environmentId }: { environmentId: string }) => {
      mocks.installed.set(environmentId, installed);
      return AsyncResult.success(skillsStatus(installed));
    });
  }
});

afterEach(() => {
  act(() => root.unmount());
  registry.dispose();
});

describe("SettingsServerControlsRouteScreen", () => {
  it("sends a draft saved during a pending write once that write settles", async () => {
    const pending = Promise.withResolvers<AsyncResult.Success<void>>();
    mocks.updateSettings.mockReturnValueOnce(pending.promise);
    act(() => render(<SettingsWorktreesRouteScreen />));

    act(() => mocks.branchNaming.onChange({ branchNamingMode: "custom" }));

    act(() => mocks.branchNaming.onChange({ branchNameInstructions: "Use issue IDs." }));
    expect(mocks.updateSettings).toHaveBeenCalledOnce();

    await act(async () => pending.resolve(AsyncResult.success(undefined)));

    expect(mocks.updateSettings).toHaveBeenCalledTimes(2);
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      environmentId: "local",
      input: {
        patch: { branchNamingMode: "custom", branchNameInstructions: "Use issue IDs." },
      },
    });
  });

  it("installs and removes orchestration skills only in permitted selected environments", async () => {
    mocks.targets = [environment("local", "Local"), environment("remote", "Remote")];
    await act(async () => render(<SettingsThreadsRouteScreen />));
    expect(button("Install").disabled).toBe(false);
    await act(async () => button("Install").click());
    expect(mocks.skillsInstall).toHaveBeenCalledExactlyOnceWith({
      environmentId: "local",
      input: {},
    });
    expect(container.textContent).toContain(
      "Remote: This connection does not have permission to manage provider skills.",
    );
    await act(async () => button("Uninstall").click());
    expect(mocks.skillsUninstall).toHaveBeenCalledExactlyOnceWith({
      environmentId: "local",
      input: {},
    });
  });

  it("loads the newly selected environment before offering skill actions", async () => {
    await act(async () => render(<SettingsThreadsRouteScreen />));
    expect(button("Install").disabled).toBe(false);
    await act(async () => {
      mocks.targets = [environment("remote", "Remote")];
      mocks.permissions.add("remote");
      mocks.installed.set("remote", true);
      for (const listener of mocks.targetListeners) listener();
    });
    expect(button("Installed").disabled).toBe(true);
    await act(async () => button("Uninstall").click());
    expect(mocks.skillsUninstall).toHaveBeenCalledExactlyOnceWith({
      environmentId: "remote",
      input: {},
    });
  });
});
