import { RegistryProvider } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ThreadId,
  type DatabaseStorageStatus,
  type StorageCleanupReport,
} from "@supaterm/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: {} as typeof DEFAULT_SERVER_SETTINGS,
  run: vi.fn(),
  report: null as StorageCleanupReport | null,
  databaseStorage: null as DatabaseStorageStatus | null,
}));

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const report = Atom.make(() => ({ _tag: "Success", value: state.report, waiting: false }));
  const databaseStorage = Atom.make(() => ({
    _tag: "Success",
    value: state.databaseStorage,
    waiting: false,
  }));
  const allowed = Atom.make(true);
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      storageCleanupReport: (() => report) as never,
      databaseStorage: (() => databaseStorage) as never,
      runStorageCleanup: {
        ...actual.serverEnvironment.runStorageCleanup,
        permissionAtom: () => allowed,
      },
    },
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.run) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => {
    const environment = {
      environmentId: "env",
      label: "Machine",
      serverConfig: {
        settings: state.settings,
        environment: {
          capabilities: {
            storageCleanup: true,
            storageCleanupRun: true,
          },
        },
      },
    };
    return {
      scope: { kind: "environment" },
      environments: [environment],
      connectedEnvironments: [environment],
      targets: [],
      target: null,
    };
  }) as never,
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings) as never,
  useScopedSettingsMixed: () => false,
  useUpdateScopedSettings: () => vi.fn(),
  useClearScopedSettings: () => vi.fn(),
}));
// The real page container needs a router and the real row reads write permission and
// overrides from live environment state; this suite is about the cleanup panel.
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsPageContainer: (({ children }: { children: ReactNode }) => children) as never,
  SettingsRow: ({ title, description, control, children }) => (
    <div>
      <h3>{title}</h3>
      {description}
      {control}
      {children}
    </div>
  ),
  SettingResetButton: (() => null) as never,
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: vi.fn() } };
});

import { clickOnFakeClock } from "~/test/inlineConfirm";
import { StorageSettingsPanel } from "./StorageSettings";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ now: 0 });
  state.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    storageCleanup: {
      worktreeKeepWhen: "uncommitted-changes",
      worktreeAfterDays: null,
      worktreeDoneAfterDays: null,
      worktreeOnMerge: false,
      worktreeOnDelete: false,
      worktreeUnchanged: false,
      browserArtifactsAfterDays: null,
      logsAfterDays: null,
    },
    projectSettingsOverrides: {},
  };
  state.report = null;
  state.databaseStorage = null;
  state.run.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      <RegistryProvider>
        <StorageSettingsPanel />
      </RegistryProvider>,
    ),
  );
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.endsWith("Confirm delete"),
  )!;
}

async function pressTwice(button: HTMLButtonElement) {
  await act(async () => clickOnFakeClock(button));
  await act(async () => vi.advanceTimersByTime(500));
  await act(async () => clickOnFakeClock(button));
}

it.each(["machine-wide immediate", "project custom"])(
  "runs cleanup when only %s done retention is enabled",
  async (scope) => {
    if (scope === "machine-wide immediate") {
      state.settings = {
        ...state.settings,
        storageCleanup: { ...state.settings.storageCleanup, worktreeDoneAfterDays: 0 },
      };
    } else {
      state.settings = {
        ...state.settings,
        projectSettingsOverrides: {
          [ProjectId.make("project")]: {
            worktreeCleanup: {
              mode: "custom",
              rules: { ...state.settings.storageCleanup, worktreeDoneAfterDays: 7 },
            },
          },
        },
      };
    }
    const report: StorageCleanupReport = {
      trigger: "manual",
      startedAt: "2026-10-14T12:00:00.000Z",
      finishedAt: "2026-10-14T12:00:01.000Z",
      entries: [],
      counts: { removed: 0, kept: 0, failed: 0 },
      omittedCount: 0,
      bytesFreed: 0,
    };
    let complete!: (result: { _tag: "Success"; value: StorageCleanupReport }) => void;
    state.run.mockImplementation(() => new Promise((resolve) => (complete = resolve)));
    const button = await render();

    expect(button.disabled).toBe(false);
    await pressTwice(button);
    expect(state.run).toHaveBeenCalledExactlyOnceWith({ environmentId: "env", input: {} });
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Deleting…");

    await act(async () => complete({ _tag: "Success", value: report }));
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("Delete now");
  },
);

it("keeps cleanup disabled when done retention and all other rules are off", async () => {
  const button = await render();

  expect(button.disabled).toBe(true);
  await pressTwice(button);
  expect(state.run).not.toHaveBeenCalled();
});

it("shows an orphan's full path and size while keeping thread row titles unchanged", async () => {
  state.settings = {
    ...state.settings,
    storageCleanup: { ...state.settings.storageCleanup, worktreeDoneAfterDays: 0 },
  };
  state.report = {
    trigger: "manual",
    startedAt: "2026-10-14T12:00:00.000Z",
    finishedAt: "2026-10-14T12:00:01.000Z",
    entries: [
      {
        kind: "worktree",
        outcome: "kept",
        path: "/worktrees/repo/orphan",
        threadId: null,
        threadTitle: null,
        reason: "No thread uses this folder, and it isn't a git worktree",
        bytes: 6600000,
        files: null,
      },
      {
        kind: "worktree",
        outcome: "kept",
        path: "/worktrees/repo/thread-checkout",
        threadId: ThreadId.make("thread"),
        threadTitle: "Thread title",
        reason: "Thread is running or has pending work",
        bytes: null,
        files: null,
      },
    ],
    counts: { removed: 0, kept: 2, failed: 0 },
    omittedCount: 0,
    bytesFreed: 0,
  };
  await render();
  const lastRun = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Last run"),
  )!;
  await act(async () => lastRun.click());
  const titles = Array.from(container.querySelectorAll("h3"), (heading) => heading.textContent);
  expect(titles).toContain("/worktrees/repo/orphan");
  expect(titles).toContain("thread-checkout");
  expect(titles).not.toContain("/worktrees/repo/thread-checkout");
  expect(container.textContent).toContain(
    "No thread uses this folder, and it isn't a git worktree",
  );
  expect(container.textContent).toContain("6.29 MB");
  expect(container.textContent).toContain("0 B recovered.");
});

it.each([
  ["an unconverted database with 2 GiB free", {}, true],
  ["a database that already shrinks itself", { incrementalVacuumEnabled: true }, false],
  ["less than 1 GiB free", { reclaimableBytes: 512 * 1024 ** 2 }, false],
] as const)("suggests supaterm doctor for %s", async (_name, change, shown) => {
  const status = {
    databaseBytes: 4 * 1024 ** 3,
    reclaimableBytes: 2 * 1024 ** 3,
    incrementalVacuumEnabled: false,
    compactCommand: "supaterm doctor --base-dir /home/jane/.supaterm",
    ...change,
  };
  state.databaseStorage = status;
  await render();
  expect(container.textContent?.includes("Reclaim 2.0 GiB on Machine")).toBe(shown);
  expect(container.textContent?.includes(status.compactCommand)).toBe(shown);
});
