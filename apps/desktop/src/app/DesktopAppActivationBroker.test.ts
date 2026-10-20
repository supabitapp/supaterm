import { ProjectId, ThreadId, type DesktopAppActivationRequest } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { DesktopAppActivationBroker } from "./DesktopAppActivationBroker.ts";

const request: DesktopAppActivationRequest = {
  version: 1,
  requestId: "request-1",
  type: "open-workspace",
  workspaceRoot: "/workspace/project",
  platform: "linux",
};

describe("DesktopAppActivationBroker", () => {
  it("focuses immediately and waits for renderer readiness", async () => {
    const activate = vi.fn();
    const send = vi.fn();
    const broker = new DesktopAppActivationBroker({ activate });

    const response = broker.request(request);
    expect(activate).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();

    broker.registerRenderer(send);
    expect(send).toHaveBeenCalledWith(request);
    broker.complete({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
    });

    await expect(response).resolves.toMatchObject({ ok: true, projectId: "project-1" });
    broker.close();
  });

  it("fails an in-flight request when the renderer goes away", async () => {
    const broker = new DesktopAppActivationBroker({ activate: vi.fn() });
    broker.registerRenderer(vi.fn());

    const response = broker.request(request);
    broker.clearRenderer();

    await expect(response).resolves.toMatchObject({
      ok: false,
      code: "request-timeout",
    });
    broker.close();
  });

  it("queues requests after unsubscribe until a new renderer registers", async () => {
    const previousSend = vi.fn();
    const nextSend = vi.fn();
    const broker = new DesktopAppActivationBroker({ activate: vi.fn() });
    broker.registerRenderer(previousSend);
    broker.clearRenderer();

    const response = broker.request(request);
    expect(previousSend).not.toHaveBeenCalled();
    expect(nextSend).not.toHaveBeenCalled();

    broker.registerRenderer(nextSend);
    expect(nextSend).toHaveBeenCalledWith(request);
    broker.complete({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
    });

    await expect(response).resolves.toMatchObject({ ok: true });
    broker.close();
  });

  it("removes a queued request when its CLI connection closes", async () => {
    const send = vi.fn();
    const broker = new DesktopAppActivationBroker({ activate: vi.fn() });

    const response = broker.request(request);
    broker.cancel(request.requestId);
    broker.registerRenderer(send);

    await expect(response).resolves.toMatchObject({ ok: false, code: "renderer-unavailable" });
    expect(send).not.toHaveBeenCalled();
    broker.close();
  });

  it("never sends a canceled request that was queued behind another request", async () => {
    const send = vi.fn();
    const broker = new DesktopAppActivationBroker({ activate: vi.fn() });
    broker.registerRenderer(send);
    const secondRequest = { ...request, requestId: "request-2" };

    const firstResponse = broker.request(request);
    const secondResponse = broker.request(secondRequest);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(request);

    broker.cancel(secondRequest.requestId);
    broker.complete({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
    });

    await expect(firstResponse).resolves.toMatchObject({ ok: true });
    await expect(secondResponse).resolves.toMatchObject({ ok: false });
    expect(send).toHaveBeenCalledTimes(1);
    broker.close();
  });

  it("gives connection registration a longer deadline", async () => {
    vi.useFakeTimers();
    try {
      const broker = new DesktopAppActivationBroker({ activate: vi.fn() });
      broker.registerRenderer(vi.fn());
      const response = broker.request({
        version: 1,
        requestId: "connection-request",
        type: "add-connection",
        pairingUrl: "https://remote.example/pair#token=secret",
      });
      let completed = false;
      void response.then(() => {
        completed = true;
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(44_000);
      await expect(response).resolves.toMatchObject({
        ok: false,
        code: "request-timeout",
      });
      broker.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an undispatched connection request as renderer unavailable", async () => {
    vi.useFakeTimers();
    try {
      const broker = new DesktopAppActivationBroker({ activate: vi.fn() });
      const response = broker.request({
        version: 1,
        requestId: "queued-connection",
        type: "add-connection",
        pairingUrl: "https://remote.example/pair#token=secret",
      });
      await vi.advanceTimersByTimeAsync(45_000);
      await expect(response).resolves.toMatchObject({ ok: false, code: "renderer-unavailable" });
      const send = vi.fn();
      broker.registerRenderer(send);
      expect(send).not.toHaveBeenCalled();
      broker.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["clearRenderer", "close"] as const)(
    "keeps a dispatched connection result ambiguous on %s",
    async (operation) => {
      const broker = new DesktopAppActivationBroker({ activate: vi.fn() });
      broker.registerRenderer(vi.fn());
      const response = broker.request({
        version: 1,
        requestId: "dispatched-connection",
        type: "add-connection",
        pairingUrl: "https://remote.example/pair#token=secret",
      });
      broker[operation]();
      await expect(response).resolves.toMatchObject({ ok: false, code: "request-timeout" });
      broker.close();
    },
  );

  it("times out a request without polling", async () => {
    vi.useFakeTimers();
    try {
      const broker = new DesktopAppActivationBroker({ activate: vi.fn() });
      broker.registerRenderer(vi.fn());
      const response = broker.request(request);

      await vi.advanceTimersByTimeAsync(15_000);

      await expect(response).resolves.toMatchObject({ ok: false, code: "request-timeout" });
      broker.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
