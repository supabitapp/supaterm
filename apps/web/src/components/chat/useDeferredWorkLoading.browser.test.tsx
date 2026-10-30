import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock(
  import("../../state/threads"),
  () => ({ threadEnvironment: { loadEarlierHistory: {} } }) as never,
);
vi.mock(
  import("../../state/use-atom-command"),
  () => ({ useAtomCommand: () => state.load }) as never,
);
import { useDeferredWorkLoading } from "./useDeferredWorkLoading";

const threadRef = { environmentId: EnvironmentId.make("one"), threadId: ThreadId.make("thread") };
function Probe({ anchor }: { anchor: string }) {
  const { error, loading, toggle } = useDeferredWorkLoading(
    threadRef,
    { expanded: true, deferredWorkItemIds: [anchor] },
    () => {},
  );
  return (
    <button type="button" onClick={toggle}>
      {error ?? (loading ? "loading" : "ready")}
    </button>
  );
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("deferred history loading", () => {
  it("ignores an old anchor failure after the row changes", async () => {
    const old = deferred();
    const current = deferred();
    state.load.mockReset().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await using screen = await render(<Probe anchor="old" />, { router: false });
    await screen.rerender(<Probe anchor="current" />);
    await act(() => {
      old.resolve({ _tag: "Failure" });
    });
    await expect.element(screen.getByRole("button")).toHaveTextContent("loading");
    await act(() => {
      current.resolve({ _tag: "Success", value: { _tag: "ok" } });
    });
  });
  it("retries the current failure and drops its previous error", async () => {
    const retried = deferred();
    state.load
      .mockReset()
      .mockResolvedValueOnce({ _tag: "Failure" })
      .mockReturnValueOnce(retried.promise);
    await using screen = await render(<Probe anchor="current" />, { router: false });
    await expect
      .element(screen.getByRole("button"))
      .toHaveTextContent("Couldn't load work. Click to retry.");
    await screen.getByRole("button").click();
    await expect.element(screen.getByRole("button")).toHaveTextContent("loading");
    await act(() => {
      retried.resolve({ _tag: "Success", value: { _tag: "ok" } });
    });
    expect(state.load).toHaveBeenCalledTimes(2);
  });
});
