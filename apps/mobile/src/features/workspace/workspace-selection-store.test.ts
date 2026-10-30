import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type DetailResult = AsyncResult.AsyncResult<{ status: string }>;

const atoms = await vi.hoisted(async () => {
  const { Atom, AtomRegistry, AsyncResult } = await import("effect/reactivity");
  return {
    registry: AtomRegistry.make(),
    detail: Atom.make<DetailResult>(AsyncResult.success({ status: "live" })),
    presentations: Atom.make(new Map<string, object>([["environment", {}]])),
  };
});

vi.mock("react-native", () => ({
  Platform: { OS: "ios", isPad: true },
  Dimensions: { get: () => ({ width: 1024, height: 768 }) },
  AppState: { addEventListener: vi.fn() },
}));
vi.mock("expo-linking", () => ({ createURL: (path: string) => `supaterm://${path}` }));
vi.mock("../../lib/root-stack-reset", () => ({ rootStackState: () => undefined }));
vi.mock("../../native/native-layout-metrics", () => ({
  currentNativeLayoutMetrics: () => null,
  firstNativeLayoutMetrics: () => Promise.resolve(null),
}));
vi.mock("../../persistence/imperative", () => ({
  loadPreferences: async () => ({
    workspaceSelections: { threads: { environmentId: "environment", threadId: "older-thread" } },
  }),
  savePreferencesPatch: async () => {},
}));
vi.mock("../../connection/catalog", async () => {
  const { Atom } = await import("effect/reactivity");
  return { environmentCatalog: { catalogValueAtom: Atom.make({ isReady: true }) } };
});
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: atoms.presentations },
}));
vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: atoms.registry }));
vi.mock("../../state/threads", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentThreads: { stateAtom: () => atoms.detail },
    environmentThreadShells: { environmentThreadIndexAtom: () => Atom.make(new Map()) },
    threadEnvironment: { snapshotAtom: () => Atom.make({ threads: [] }) },
    startOpeningEnvironmentThread: vi.fn(),
  };
});

import { startOpeningEnvironmentThread } from "../../state/threads";
import { launchWorkspaceURL, workspaceSelectionCheck } from "./workspace-selection-store";

const selection = { environmentId: "environment", threadId: "older-thread" };
beforeEach(() => {
  atoms.registry.set(atoms.detail, AsyncResult.success({ status: "live" }));
  atoms.registry.set(atoms.presentations, new Map([["environment", {}]]));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("remembered thread restoration", () => {
  it("opens an existing older thread omitted by the bounded shell", async () => {
    expect(workspaceSelectionCheck.thread(selection)).toBe(true);
    expect(await launchWorkspaceURL()).toBe("supaterm://threads/environment/older-thread");
    expect(startOpeningEnvironmentThread).toHaveBeenCalledWith("environment", "older-thread");
  });

  it("rejects an authoritative deletion and allows a lookup still loading", () => {
    atoms.registry.set(atoms.detail, AsyncResult.success({ status: "deleted" }));
    expect(workspaceSelectionCheck.thread(selection)).toBe(false);
    atoms.registry.set(atoms.detail, AsyncResult.initial());
    expect(workspaceSelectionCheck.thread(selection)).toBe(true);
  });

  it("rejects a removed environment even when its old thread detail remains cached", () => {
    atoms.registry.set(atoms.presentations, new Map());
    expect(workspaceSelectionCheck.thread(selection)).toBe(false);
  });
});
