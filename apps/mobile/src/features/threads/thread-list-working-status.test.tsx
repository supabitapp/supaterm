import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ThreadListWorkingStatus } from "./thread-list-working-status";

const app = vi.hoisted(() => ({
  state: "active",
  listeners: new Set<(state: string) => void>(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return app.state;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      app.listeners.add(listener);
      return { remove: () => app.listeners.delete(listener) };
    },
  },
}));
vi.mock("../../components/ui/AppText", () => ({ AppText: "span" }));

const startedAt = "2026-10-06T10:00:00.000Z";
let renderer: ReactTestRenderer | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(startedAt) + 42_000);
  app.state = "active";
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  app.listeners.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(start: string | null, label = "Working") {
  await act(() => {
    renderer = create(
      <ThreadListWorkingStatus label={label} startedAt={start} className="text-xs" />,
    );
  });
}

function text() {
  return renderer?.root.findByType("span").children.join("");
}

it("updates seconds, minutes, and hours without rerendering the row", async () => {
  const rowRender = vi.fn();
  function Row() {
    rowRender();
    return <ThreadListWorkingStatus label="Working" startedAt={startedAt} className="text-xs" />;
  }
  await act(() => {
    renderer = create(<Row />);
  });
  expect(text()).toBe("Working 42s");
  await act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(text()).toBe("Working 43s");
  await act(() => {
    vi.advanceTimersByTime(17_000);
  });
  expect(text()).toBe("Working 1m");
  vi.setSystemTime(Date.parse(startedAt) + 90 * 60_000);
  await act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(text()).toBe("Working 1h 30m");
  expect(rowRender).toHaveBeenCalledTimes(1);
});

it.each(["Waiting", "Goal"])("keeps the %s status alongside its duration", async (label) => {
  await mount(startedAt, label);
  expect(text()).toBe(`${label} 42s`);
});

it.each([null, "invalid"])("leaves unknown start %s untimed", async (start) => {
  await mount(start);
  expect(text()).toBe("Working");
  expect(vi.getTimerCount()).toBe(0);
  expect(app.listeners.size).toBe(0);
});

it("pauses in the background and catches up immediately on return", async () => {
  await mount(startedAt);
  await act(() => {
    app.state = "background";
    for (const listener of app.listeners) listener(app.state);
  });
  expect(vi.getTimerCount()).toBe(0);
  await act(() => {
    vi.advanceTimersByTime(120_000);
  });
  expect(text()).toBe("Working 42s");
  await act(() => {
    app.state = "active";
    for (const listener of app.listeners) listener(app.state);
  });
  expect(text()).toBe("Working 2m");
  await act(() => renderer?.unmount());
  renderer = null;
  expect(vi.getTimerCount()).toBe(0);
  expect(app.listeners.size).toBe(0);
});

it("resets when a recycled row receives a different work start, then removes the timer on completion", async () => {
  await mount(startedAt);
  const nextStart = new Date(Date.parse(startedAt) + 37_000).toISOString();
  await act(() => {
    renderer?.update(
      <ThreadListWorkingStatus
        key={nextStart}
        label="Working"
        startedAt={nextStart}
        className="text-xs"
      />,
    );
  });
  expect(text()).toBe("Working 5s");
  expect(vi.getTimerCount()).toBe(1);
  await act(() => {
    renderer?.update(<ThreadListWorkingStatus label="Done" startedAt={null} className="text-xs" />);
  });
  expect(text()).toBe("Done");
  expect(vi.getTimerCount()).toBe(0);
  expect(app.listeners.size).toBe(0);
});
