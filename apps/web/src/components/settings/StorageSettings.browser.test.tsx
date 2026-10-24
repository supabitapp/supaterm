import { act, fakeTimers, render } from "../../../test/render";
import { RegistryProvider } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  type DatabaseStorageStatus,
  type StorageCleanupReport,
} from "@supaterm/contracts";
import { type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: {} as typeof DEFAULT_SERVER_SETTINGS,
  run: vi.fn(),
  report: null as StorageCleanupReport | null,
  databaseRecommendations: [] as Array<{ environmentId: string; status: DatabaseStorageStatus }>,
  databaseRecommendationKeys: [] as string[],
  extraEnvironments: [] as Array<{ environmentId: string; label: string }>,
}));

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const report = Atom.make(() => ({ _tag: "Success", value: state.report, waiting: false }));
  const databaseRecommendations = Atom.make(() => state.databaseRecommendations);
  const allowed = Atom.make(true);
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      storageCleanupReport: (() => report) as never,
      databaseCompactionRecommendations: ((key: string) => {
        state.databaseRecommendationKeys.push(key);
        return databaseRecommendations;
      }) as never,
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
      label: "Build workstation",
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
    const connectedEnvironments = [
      environment,
      ...state.extraEnvironments.map((extra) => ({ ...environment, ...extra })),
    ];
    return {
      scope: { kind: "environment" },
      environments: connectedEnvironments,
      connectedEnvironments,
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

function setup(): Disposable {
  const timers = fakeTimers({ now: 0 });
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
  state.databaseRecommendations = [];
  state.databaseRecommendationKeys = [];
  state.extraEnvironments = [];
  localStorage.removeItem("database-storage-notice-dismissed");
  state.run.mockReset();
  return timers;
}

const panel = () => (
  <RegistryProvider>
    <StorageSettingsPanel />
  </RegistryProvider>
);
const deleteButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.endsWith("Confirm delete"),
  )!;

async function pressTwice(button: HTMLButtonElement) {
  await act(async () => clickOnFakeClock(button));
  await act(async () => vi.advanceTimersByTime(500));
  await act(async () => clickOnFakeClock(button));
}

it("keeps cleanup disabled when done retention and all other rules are off", async () => {
  using _timers = setup();
  await using screen = await render(panel());
  const button = deleteButton(screen.container);

  expect(button.disabled).toBe(true);
  await pressTwice(button);
  expect(state.run).not.toHaveBeenCalled();
});

it("lists every machine's reclaimable database space and dismisses one machine at a time", async () => {
  const status = (reclaimableGiB: number, baseDir: string) => ({
    databaseBytes: 4 * 1024 ** 3,
    reclaimableBytes: reclaimableGiB * 1024 ** 3,
    incrementalVacuumEnabled: false,
    compactCommand: `supaterm doctor --base-dir ${baseDir}`,
  });
  using _timers = setup();
  state.extraEnvironments = [{ environmentId: "laptop", label: "Laptop" }];
  state.databaseRecommendations = [
    { environmentId: "laptop", status: status(3, "/Users/jane/.supaterm") },
    { environmentId: "env", status: status(2, "/home/jane/.supaterm") },
  ];
  await using screen = await render(panel());
  const { container } = screen;
  const headings = () =>
    Array.from(container.querySelectorAll("h3"), (heading) => heading.textContent);
  expect(headings()).toEqual(
    expect.arrayContaining([
      "Reclaim freed database space",
      "3.0 GiB on Laptop",
      "2.0 GiB on Build workstation",
    ]),
  );
  expect(container.textContent).toContain("supaterm doctor --base-dir /Users/jane/.supaterm");
  expect(state.databaseRecommendationKeys.at(-1)).toBe(JSON.stringify(["env", "laptop"]));

  const dismissButtons = () =>
    Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "Dismiss",
    );
  await act(async () => dismissButtons()[0]!.click());
  expect(headings()).not.toContain("3.0 GiB on Laptop");
  expect(headings()).toContain("2.0 GiB on Build workstation");
  expect(JSON.parse(localStorage.getItem("database-storage-notice-dismissed")!)).toEqual([
    "laptop",
  ]);

  await act(async () => dismissButtons()[0]!.click());
  expect(headings()).not.toContain("Reclaim freed database space");
});
