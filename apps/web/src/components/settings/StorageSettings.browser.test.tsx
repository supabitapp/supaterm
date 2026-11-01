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
  targets: [] as Array<{ environmentId: string; settings: typeof DEFAULT_SERVER_SETTINGS }>,
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
    const environmentFor = (
      environmentId: string,
      label: string,
      settings: typeof DEFAULT_SERVER_SETTINGS,
    ) => ({
      environmentId,
      label,
      serverConfig: {
        settings,
        environment: {
          capabilities: {
            storageCleanup: true,
            storageCleanupRun: true,
          },
        },
      },
    });
    if (state.targets.length > 0) {
      const environments = state.targets.map(({ environmentId, settings }) =>
        environmentFor(environmentId, environmentId, settings),
      );
      return {
        scope: { kind: "all" },
        environments,
        connectedEnvironments: environments,
        targets: state.targets,
        target: null,
      };
    }
    const environment = environmentFor("env", "Build workstation", state.settings);
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
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsPageContainer: (({ children }: { children: ReactNode }) => children) as never,
  SettingsRow: ({ title, description, status, control, children }) => (
    <div>
      <h3>{title}</h3>
      {description}
      {status && (
        <div
          data-testid={`${title === "Delete old browser artifacts" ? "artifact" : "logs"}-retention-status`}
        >
          {status}
        </div>
      )}
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
import { StorageCleanupSections } from "./StorageSettings";

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
  state.targets = [];
  state.report = null;
  state.databaseRecommendations = [];
  state.databaseRecommendationKeys = [];
  state.extraEnvironments = [];
  localStorage.removeItem("database-storage-notice-dismissed");
  state.run.mockReset();
  return timers;
}

function setRetentionValues(
  artifactDays: ReadonlyArray<number | null>,
  logDays: ReadonlyArray<number | null> = artifactDays.map(() => null),
  environmentIds: readonly string[] = ["env-a", "env-b"],
) {
  state.targets = artifactDays.map((browserArtifactsAfterDays, index) => ({
    environmentId: environmentIds[index]!,
    settings: {
      ...state.settings,
      storageCleanup: {
        ...state.settings.storageCleanup,
        browserArtifactsAfterDays,
        logsAfterDays: logDays[index]!,
      },
    },
  }));
  state.settings = state.targets[0]?.settings ?? state.settings;
}

const panel = () => (
  <RegistryProvider>
    <StorageCleanupSections />
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

it("settles mixed retention statuses independently across selected machines", async () => {
  using _timers = setup();
  setRetentionValues([null, null]);
  await using screen = await render(panel());
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  await advance(300);
  setRetentionValues([8, null], [8, null]);
  await screen.rerender(panel());
  await advance(125);
  await expect.element(screen.getByTestId("artifact-retention-status")).not.toBeInTheDocument();
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();
  setRetentionValues([null, null], [8, null]);
  await screen.rerender(panel());
  await advance(8);
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();
  await advance(117);
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();
  setRetentionValues([null, null]);
  await screen.rerender(panel());
  await advance(300);
  await expect.element(screen.getByTestId("artifact-retention-status")).not.toBeInTheDocument();
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();

  setRetentionValues([8, null]);
  await screen.rerender(panel());
  await advance(300);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();

  setRetentionValues([null, null]);
  await screen.rerender(panel());
  await advance(75);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  setRetentionValues([8, null]);
  await screen.rerender(panel());
  await advance(133);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  setRetentionValues([null, null]);
  await screen.rerender(panel());
  await advance(133);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  await advance(117);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  setRetentionValues([8, null]);
  await screen.rerender(panel());
  await advance(300);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");

  setRetentionValues([8], [null], ["env-c"]);
  await screen.rerender(panel());
  await expect.element(screen.getByTestId("artifact-retention-status")).not.toBeInTheDocument();

  setRetentionValues([null, null], [null, null], ["env-c", "env-d"]);
  await screen.rerender(panel());
  await expect.element(screen.getByTestId("artifact-retention-status")).not.toBeInTheDocument();

  setRetentionValues([null, null], [8, null]);
  await screen.rerender(panel());
  await advance(300);
  await expect.element(screen.getByTestId("artifact-retention-status")).not.toBeInTheDocument();
  await expect
    .element(screen.getByTestId("logs-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  setRetentionValues([null, null]);
  await screen.rerender(panel());
  await advance(300);
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();
});
