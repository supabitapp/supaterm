import { EnvironmentId } from "@supaterm/contracts";
import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

type Route = { readonly key: string; readonly name: string; readonly params?: object };

const harness = vi.hoisted(() => ({
  rootState: { index: 0, routes: [] as Array<Route> },
  draftsLoaded: Promise.resolve(),
  selectDetail: vi.fn(),
  alert: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ isFocused: () => true }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));
vi.mock("../../components/ui/Dialog", () => ({ alert: harness.alert }));
vi.mock("../../lib/authClientMetadata", () => ({ authClientMetadata: () => ({}) }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "request" }));
vi.mock("../../lib/rootNavigation", () => ({
  rootNavigationRef: { getRootState: () => harness.rootState },
}));
vi.mock("../../state/projects", () => ({ projectEnvironment: { openScratch: "openScratch" } }));
vi.mock("../../state/server", () => ({ serverEnvironment: { prepareTriage: "prepareTriage" } }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => async () =>
    command === "openScratch"
      ? { _tag: "Success", value: { id: "scratch" } }
      : { _tag: "Success", value: { prompt: "Triage this." } },
}));
vi.mock("../../state/use-composer-drafts", () => ({
  createNewTaskDraft: () => "draft",
  setComposerDraftText: vi.fn(),
  waitForComposerDraftsLoaded: () => harness.draftsLoaded,
}));
vi.mock("../workspace/useSelectWorkspaceDetail", () => ({
  useSelectWorkspaceDetail: () => harness.selectDetail,
}));

import { useStartTriage } from "./useStartTriage";

const environmentId = EnvironmentId.make("machine");
let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

async function mountStartTriage() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let startTriage!: ReturnType<typeof useStartTriage>["startTriage"];
  function Probe() {
    const value = useStartTriage();
    useLayoutEffect(() => {
      startTriage = value.startTriage;
    });
    return null;
  }
  await act(() => {
    renderer = create(<Probe />);
  });
  return (id: EnvironmentId) => startTriage(id);
}

function showThread(params: object) {
  harness.rootState = { index: 0, routes: [{ key: "thread", name: "Thread", params }] };
}

it("opens the triage draft only while the workspace still shows the thread it started on", async () => {
  showThread({ environmentId: "machine", threadId: "first" });
  const startTriage = await mountStartTriage();
  await act(() => startTriage(environmentId));
  expect(harness.selectDetail).toHaveBeenCalledTimes(1);

  let loadDrafts!: () => void;
  harness.draftsLoaded = new Promise<void>((resolve) => {
    loadDrafts = resolve;
  });
  let pending!: Promise<void>;
  await act(() => {
    pending = startTriage(environmentId);
  });
  showThread({ environmentId: "machine", threadId: "second" });
  await act(async () => {
    loadDrafts();
    await pending;
  });
  expect(harness.selectDetail).toHaveBeenCalledTimes(1);
  expect(harness.alert).not.toHaveBeenCalled();
});
