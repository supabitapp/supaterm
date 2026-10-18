import { EnvironmentId, type PullRequestCheck } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  status: "success" as PullRequestCheck["status"],
  extraStatus: null as PullRequestCheck["status"] | null,
  perform: vi.fn(),
}));

vi.mock("~/state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("~/state/pullRequests", () => ({ pullRequestEnvironment: {} }));
vi.mock("~/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
const queryData = () => ({
  number: 1,
  title: "Test PR",
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  headBranch: "feature",
  baseBranch: "main",
  changedFiles: 1,
  additions: 1,
  deletions: 0,
  checks: [state.status, ...(state.extraStatus ? [state.extraStatus] : [])].map((status) => ({
    name: `CI-${status}`,
    status,
    description: null,
    url: null,
  })),
  capabilities: { actions: ["merge"], mergeMethods: ["merge"] },
  viewerPermissions: { actions: ["merge"] },
  mergeCapabilities: { merge: true, squash: false, rebase: false },
});
vi.mock("~/state/query", () => ({
  useEnvironmentQuerySelector: (_atom: unknown, select: (result: unknown) => unknown) =>
    select(AsyncResult.success(queryData())),
  useEnvironmentQueryIsNewer: () => true,
  useEnvironmentQueryRefresh: () => ({ refresh: vi.fn(), isPending: () => false }),
}));
vi.mock("../pullRequest/usePullRequestActions", () => ({
  usePullRequestActionRunner: () => ({ actionPending: false, perform: state.perform }),
  usePullRequestHandoffs: () => ({ handoff: null, startHandoff: vi.fn() }),
}));
vi.mock("../ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, undefined, children),
  PopoverPopup: () => null,
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, undefined, children),
  TooltipPopup: () => null,
}));
import { ThreadDetailsPrRow } from "./ThreadDetailsPrRow";

let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
  state.status = "success";
  state.extraStatus = null;
  state.perform.mockClear();
});

const renderRow = () => (
  <ThreadDetailsPrRow
    environmentId={EnvironmentId.make("environment")}
    pr={null}
    number={1}
    status={null}
    project={null}
    label="Test PR"
    openAriaLabel="Open PR"
    onOpen={vi.fn()}
  />
);

const clickMerge = (timeStamp: number) =>
  act(() => {
    renderer.root
      .findAllByType("button")
      .find((button) => button.findAll((node) => node.children.includes("Merge")).length > 0)!
      .props.onClick({ timeStamp });
  });

const armed = () =>
  renderer.root.findAll(
    (node) => node.children.includes("Confirm") && node.props["aria-hidden"] !== true,
  ).length > 0;

const stubWindow = () =>
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }));

it("requires a new merge click after passing checks become pending and pass again", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stubWindow();
  act(() => {
    renderer = create(renderRow());
  });
  clickMerge(0);
  expect(armed()).toBe(true);
  act(() => {
    state.status = "pending";
    renderer.update(renderRow());
  });
  act(() => {
    state.status = "success";
    renderer.update(renderRow());
  });
  expect(armed()).toBe(false);
  clickMerge(1_000);
  expect(armed()).toBe(true);
  expect(state.perform).not.toHaveBeenCalled();
});

it("merges only on a deliberate second click", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stubWindow();
  act(() => {
    renderer = create(renderRow());
  });
  clickMerge(0);
  clickMerge(150);
  clickMerge(300);
  expect(state.perform).not.toHaveBeenCalled();
  expect(armed()).toBe(true);
  clickMerge(900);
  expect(state.perform).toHaveBeenCalledExactlyOnceWith("merge", "merge");
  expect(armed()).toBe(false);
});

it.each<[PullRequestCheck["status"], PullRequestCheck["status"]]>([
  ["success", "skipped"],
  ["failure", "cancelled"],
  ["success", "action-required"],
  ["success", "pending"],
  ["failure", "pending"],
])("omits the numeric tally for mixed check results (%s, %s)", (status, extraStatus) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.status = status;
  state.extraStatus = extraStatus;
  act(() => {
    renderer = create(
      <ThreadDetailsPrRow
        environmentId={EnvironmentId.make("environment")}
        pr={null}
        number={1}
        status={null}
        project={null}
        label="Test PR"
        openAriaLabel="Open PR"
        onOpen={vi.fn()}
      />,
    );
  });
  const text = renderer.root
    .findAllByType("span")
    .map((span) => span.children.filter((child) => typeof child === "string").join(""));
  expect(text.filter((value) => /^\d+\/\d+$/.test(value))).toEqual([]);
});
