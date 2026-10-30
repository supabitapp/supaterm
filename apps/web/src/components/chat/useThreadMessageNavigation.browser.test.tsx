import { EnvironmentId, MessageId, ThreadId, type ScopedThreadRef } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { requestThreadMessageNavigation } from "../../lib/threadMessageNavigation";
import { BackgroundThreadContext } from "./backgroundThread";
import { useThreadMessageNavigation } from "./useThreadMessageNavigation";

function Probe({
  target,
  onNavigate,
}: {
  target: ScopedThreadRef;
  onNavigate: Parameters<typeof useThreadMessageNavigation>[1];
}) {
  useThreadMessageNavigation(target, onNavigate);
  return null;
}

it("consumes a pending request and receives later requests for the same environment", async () => {
  const target = {
    environmentId: EnvironmentId.make("message-jump-a"),
    threadId: ThreadId.make("shared"),
  };
  const messageId = MessageId.make("first");
  const onNavigate = vi.fn();
  requestThreadMessageNavigation(target, messageId, "needle");
  await using screen = await render(<Probe target={target} onNavigate={onNavigate} />);
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ messageId, query: "needle" }),
  );
  const second = MessageId.make("second");
  await act(() => requestThreadMessageNavigation(target, second, "another"));
  expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ messageId: second }));
  expect(onNavigate).toHaveBeenCalledTimes(2);
  await screen.unmount();
  await act(() =>
    requestThreadMessageNavigation({ ...target, threadId: ThreadId.make("other") }, second, ""),
  );
  expect(onNavigate).toHaveBeenCalledTimes(2);
});

it("preserves requests behind settings and for a different environment", async () => {
  const target = {
    environmentId: EnvironmentId.make("message-jump-b"),
    threadId: ThreadId.make("shared"),
  };
  const other = { ...target, environmentId: EnvironmentId.make("message-jump-c") };
  const onNavigate = vi.fn();
  const messageId = MessageId.make("pending");
  await using screen = await render(
    <BackgroundThreadContext value={true}>
      <Probe target={target} onNavigate={onNavigate} />
    </BackgroundThreadContext>,
  );
  await act(() => requestThreadMessageNavigation(other, messageId, "remote"));
  await act(() => requestThreadMessageNavigation(target, messageId, "local"));
  expect(onNavigate).not.toHaveBeenCalled();
  await screen.rerender(
    <BackgroundThreadContext value={false}>
      <Probe target={target} onNavigate={onNavigate} />
    </BackgroundThreadContext>,
  );
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ threadRef: target }),
  );
  await screen.rerender(<Probe target={other} onNavigate={onNavigate} />);
  expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ threadRef: other }));
  expect(onNavigate).toHaveBeenCalledTimes(2);
});
