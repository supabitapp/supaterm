import { claimThreadOpen } from "@supaterm/client-runtime/state/thread-search";
import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@supaterm/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { fakeTimers, render } from "../../../test/render";
import { AppAtomRegistryProvider, appAtomRegistry } from "../../rpc/atomRegistry";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const mocks = vi.hoisted(() => ({
  visitRun: fake(),
}));

const shellKey = (ref: ScopedThreadRef) => `${ref.environmentId}:${ref.threadId}`;

vi.mock(import("../../state/threads"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentThreadShells: {
      ...actual.environmentThreadShells,
      threadShellAtom: ((ref: ScopedThreadRef) => shellAtom(shellKey(ref))) as never,
    },
    threadEnvironment: {
      ...actual.threadEnvironment,
      visit: { label: "visit", run: mocks.visitRun } as never,
    },
  };
});

import { ThreadVisitWatermark } from "./ThreadVisitWatermark";

const shellAtom = Atom.family((_key: string) => Atom.make<unknown>(null).pipe(Atom.keepAlive));

const NOW = Date.parse("2026-01-04T00:00:00.000Z");
const ENVIRONMENT = EnvironmentId.make("environment-visit-watermark");
const threadA: ScopedThreadRef = { environmentId: ENVIRONMENT, threadId: ThreadId.make("a") };
const threadB: ScopedThreadRef = { environmentId: ENVIRONMENT, threadId: ThreadId.make("b") };

function setShell(ref: ScopedThreadRef, updatedAt: string) {
  appAtomRegistry.set(shellAtom(shellKey(ref)), {
    environmentId: ref.environmentId,
    id: ref.threadId,
    updatedAt,
    lastVisitedAt: "2026-01-01T00:00:00.000Z",
    latestRun: null,
  });
}

function visitedThreadIds() {
  return mocks.visitRun.mock.calls.map(
    ([, input]) => (input as { input: { threadId: string } }).input.threadId,
  );
}

it("records the visit of the next thread at once after switching threads", async () => {
  mocks.visitRun.reset();
  mocks.visitRun.implement(async () => AsyncResult.success(undefined));
  setShell(threadA, "2026-01-02T00:00:00.000Z");
  setShell(threadB, "2026-01-03T00:00:00.000Z");
  using _timers = fakeTimers();
  vi.setSystemTime(NOW);
  claimThreadOpen(threadB.environmentId, threadB.threadId, NOW);

  await using screen = await render(
    <AppAtomRegistryProvider>
      <ThreadVisitWatermark threadRef={threadA} />
    </AppAtomRegistryProvider>,
  );
  expect(visitedThreadIds()).toEqual(["a"]);

  await screen.rerender(
    <AppAtomRegistryProvider>
      <ThreadVisitWatermark threadRef={threadB} />
    </AppAtomRegistryProvider>,
  );

  expect(visitedThreadIds()).toEqual(["a", "b"]);
});
