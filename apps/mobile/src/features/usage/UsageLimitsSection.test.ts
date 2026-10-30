import { EnvironmentId } from "@supaterm/contracts";
import { refreshUsageLimits } from "@supaterm/client-runtime/state/usage";
import { RegistryContext } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

type RefreshResult = AsyncResult.AsyncResult<void, string>;
type Presentation = {
  readonly connection: { readonly phase: "connected" };
  readonly entry: { readonly target: { readonly label: string } };
};

const state = await vi.hoisted(async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    presentations: Atom.make<ReadonlyMap<EnvironmentId, Presentation>>(new Map()),
    refreshProviders: vi.fn<(environmentId: string) => Promise<RefreshResult>>(),
  };
});
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("react-native", () => ({ Pressable: "button", View: "div" }));
vi.mock("../../components/ui/AppText", () => ({ AppText: "span" }));
vi.mock("../../components/ProviderIcon", () => ({ ProviderIcon: () => null }));
vi.mock("../../lib/clock", () => ({ useNowMinuteMs: () => 0 }));
vi.mock("./usageProviders", () => ({ useProviderColors: () => ({}) }));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: state.presentations },
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    refreshProviders: {
      label: "refresh providers",
      run: (_registry: unknown, input: { readonly environmentId: string }) =>
        state.refreshProviders(input.environmentId),
    },
  },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

import { useRefreshLimits } from "./UsageLimitsSection";
import { environmentIdsKey, limitsRefreshFailuresAtom } from "./usageLimitsRefresh";

const success: RefreshResult = AsyncResult.success(undefined);
const failure: RefreshResult = AsyncResult.failure(Cause.fail("offline"));
let registry: AtomRegistry.AtomRegistry;
let renderer: ReactTestRenderer | undefined;
let latest: ReturnType<typeof useRefreshLimits>;

function Probe(props: {
  readonly selected: ReadonlySet<EnvironmentId> | null;
  readonly active: boolean;
}) {
  const limits = useRefreshLimits(props.selected, props.active);
  useLayoutEffect(() => {
    latest = limits;
  });
  return null;
}

function render(selected: ReadonlySet<EnvironmentId> | null = null, active = false) {
  const element = createElement(
    RegistryContext.Provider,
    { value: registry },
    createElement(Probe, { selected, active }),
  );
  if (renderer) renderer.update(element);
  else renderer = create(element);
}

function presentation(label: string): Presentation {
  return { connection: { phase: "connected" }, entry: { target: { label } } };
}

function failuresBecome(ids: readonly EnvironmentId[], expected: readonly EnvironmentId[]) {
  const atom = limitsRefreshFailuresAtom(environmentIdsKey(ids));
  const done = Promise.withResolvers<void>();
  const unsubscribe = registry.subscribe(atom, (failures) => {
    if (
      failures.length === expected.length &&
      failures.every((id, index) => id === expected[index])
    )
      done.resolve();
  });
  return done.promise.finally(unsubscribe);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = AtomRegistry.make();
  state.refreshProviders.mockReset();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
  vi.unstubAllGlobals();
});

it("keeps a newer environment failure when an older refresh finishes", async () => {
  const a = EnvironmentId.make("mobile-limits-a");
  const b = EnvironmentId.make("mobile-limits-b");
  const pending = Promise.withResolvers<RefreshResult>();
  registry.set(state.presentations, new Map([[a, presentation("A")]]));
  state.refreshProviders.mockImplementation((environmentId) =>
    environmentId === a ? pending.promise : Promise.resolve(failure),
  );
  await act(() => render());
  let first!: Promise<void>;
  await act(() => {
    first = latest.refresh();
  });
  const bFailed = failuresBecome([a, b], [b]);
  await act(async () => {
    registry.set(
      state.presentations,
      new Map([
        [a, presentation("A")],
        [b, presentation("B")],
      ]),
    );
    render(null, true);
    await bFailed;
  });
  expect(latest.failedLabels).toEqual(["B"]);
  await act(async () => {
    pending.resolve(success);
    await first;
  });
  expect(latest.failedLabels).toEqual(["B"]);
});

it("does not let an older multi-environment batch clear a newer failure for the same environment", async () => {
  const a = EnvironmentId.make("mobile-limits-race-a");
  const b = EnvironmentId.make("mobile-limits-race-b");
  const aFirst = Promise.withResolvers<RefreshResult>();
  const bFirst = Promise.withResolvers<RefreshResult>();
  registry.set(
    state.presentations,
    new Map([
      [a, presentation("A")],
      [b, presentation("B")],
    ]),
  );
  let aCalls = 0;
  state.refreshProviders.mockImplementation((environmentId) =>
    environmentId === b
      ? bFirst.promise
      : ++aCalls === 1
        ? aFirst.promise
        : Promise.resolve(failure),
  );
  await act(() => render(null, true));
  await act(async () => {
    aFirst.resolve(success);
    await refreshUsageLimits(a, () => aFirst.promise);
  });
  const selected = new Set([a]);
  await act(() => render(selected));
  await act(async () => {
    await latest.refresh();
  });
  expect(latest.failedLabels).toEqual(["A"]);
  await act(async () => {
    bFirst.resolve(success);
    await refreshUsageLimits(b, () => bFirst.promise);
  });
  expect(latest.failedLabels).toEqual(["A"]);
});
