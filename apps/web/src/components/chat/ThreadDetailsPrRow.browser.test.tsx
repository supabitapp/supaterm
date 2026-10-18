import { EnvironmentId, type PullRequestCheck } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  status: "success" as PullRequestCheck["status"],
  extraStatus: null as PullRequestCheck["status"] | null,
  perform: vi.fn(),
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useServerConfigs: (() => new Map()) as never,
}));
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
vi.mock(import("~/state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuerySelector: ((_atom: unknown, select: (result: unknown) => unknown) =>
    select(AsyncResult.success(queryData()))) as never,
  useEnvironmentQueryIsNewer: () => true,
  useEnvironmentQueryRefresh: (() => ({ refresh: vi.fn(), isPending: () => false })) as never,
}));
vi.mock(import("../pullRequest/usePullRequestActions"), async (importOriginal) => ({
  ...(await importOriginal()),
  usePullRequestActionRunner: () => ({ actionPending: false, perform: state.perform }),
  usePullRequestHandoffs: () => ({ handoff: null, startAsk: vi.fn(), startHandoff: vi.fn() }),
}));

import { clickAt } from "~/test/inlineConfirm";
import { ThreadDetailsPrRow } from "./ThreadDetailsPrRow";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
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

const mergeButton = () =>
  [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.trim().startsWith("Merge"),
  )!;
const clickMerge = (timeStamp: number) => act(() => clickAt(mergeButton(), timeStamp));
const armed = () =>
  [...container.querySelectorAll("span")].some(
    (span) => span.textContent === "Confirm" && !span.hasAttribute("aria-hidden"),
  );

it("requires a new merge click after passing checks become pending and pass again", () => {
  const start = performance.now();
  act(() => root.render(renderRow()));
  clickMerge(start);
  expect(armed()).toBe(true);
  act(() => {
    state.status = "pending";
    root.render(renderRow());
  });
  act(() => {
    state.status = "success";
    root.render(renderRow());
  });
  expect(armed()).toBe(false);
  clickMerge(start + 1_000);
  expect(armed()).toBe(true);
  expect(state.perform).not.toHaveBeenCalled();
});

it("merges only on a deliberate second click", () => {
  const start = performance.now();
  act(() => root.render(renderRow()));
  clickMerge(start);
  clickMerge(start + 150);
  clickMerge(start + 300);
  expect(state.perform).not.toHaveBeenCalled();
  expect(armed()).toBe(true);
  clickMerge(start + 900);
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
  state.status = status;
  state.extraStatus = extraStatus;
  act(() => root.render(renderRow()));
  const counts = [...container.querySelectorAll("*")].filter((element) =>
    /^\d+\/\d+$/.test(element.textContent?.trim() ?? ""),
  );
  expect(counts).toEqual([]);
});
