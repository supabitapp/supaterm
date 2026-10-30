import { claimThreadOpen } from "@supaterm/client-runtime/state/thread-search";
import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@supaterm/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { fakeTimers, render } from "../../../test/render";
import { AppAtomRegistryProvider, appAtomRegistry } from "../../rpc/atomRegistry";

const mocks = vi.hoisted(() => ({
  visitRun: vi.fn(),
}));

const shellKey = (ref: ScopedThreadRef) => `${ref.environmentId}:${ref.threadId}`;

vi.mock(import("../../state/threads"), () => {
  return {
    environmentThreadShells: {
      threadShellAtom: ((ref: ScopedThreadRef) => shellAtom(shellKey(ref))) as never,
    },
    threadEnvironment: {
      visit: { label: "visit", run: mocks.visitRun } as never,
    },
  } as never;
});

vi.mock(import("../../state/entities"), async () => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    useThreadShell: (ref: ScopedThreadRef) => useAtomValue(shellAtom(shellKey(ref))),
  } as never;
});
vi.mock(
  import("../../state/use-atom-command"),
  () =>
    ({
      useAtomCommand: () => (input: unknown) => mocks.visitRun(appAtomRegistry, input),
    }) as never,
);

import { ThreadVisitWatermark } from "./ThreadVisitWatermark";
import { BackgroundThreadContext } from "./backgroundThread";

// Kept alive so a shell set before its tracker mounts is still there when it does.
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
  mocks.visitRun.mockReset();
  mocks.visitRun.mockResolvedValue(AsyncResult.success(undefined));
  setShell(threadA, "2026-01-02T00:00:00.000Z");
  setShell(threadB, "2026-01-03T00:00:00.000Z");
  using _timers = fakeTimers();
  vi.setSystemTime(NOW);
  // A palette pick already sent B's open with its query, so B's visit is a plain watermark advance.
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

  // Thread A's throttle must not hold back B's first watermark: leaving B
  // within the throttle window would otherwise keep it unread.
  expect(visitedThreadIds()).toEqual(["a", "b"]);
});

it("does not visit a retained background workspace until it becomes active", async () => {
  mocks.visitRun.mockReset();
  mocks.visitRun.mockResolvedValue(AsyncResult.success(undefined));
  const ref = { environmentId: ENVIRONMENT, threadId: ThreadId.make("background") };
  setShell(ref, "2026-01-03T00:00:00.000Z");
  await using screen = await render(
    <AppAtomRegistryProvider>
      <BackgroundThreadContext value={true}>
        <ThreadVisitWatermark threadRef={ref} />
      </BackgroundThreadContext>
    </AppAtomRegistryProvider>,
  );
  expect(visitedThreadIds()).toEqual([]);
  await screen.rerender(
    <AppAtomRegistryProvider>
      <BackgroundThreadContext value={false}>
        <ThreadVisitWatermark threadRef={ref} />
      </BackgroundThreadContext>
    </AppAtomRegistryProvider>,
  );
  expect(visitedThreadIds()).toEqual(["background"]);
});
