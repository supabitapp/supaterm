import { ConnectionBlockedError } from "@supaterm/client-runtime/connection";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { Persistence } from "@supaterm/client-runtime/platform";
import { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createDesktopAppActivationRunner,
  handleDesktopAppActivationRequest,
  handleDesktopAppConnectionRequest,
  type DesktopAppActivationDependencies,
} from "./desktopAppActivation";

const environmentId = EnvironmentId.make("primary");
const existingProjectId = ProjectId.make("project-existing");
const createdProjectId = ProjectId.make("project-created");
const threadId = ThreadId.make("thread-1");
const request = {
  version: 1,
  requestId: "request-1",
  type: "open-workspace",
  workspaceRoot: "/workspace/project",
  platform: "linux",
} as const;

function dependencies(
  overrides: Partial<DesktopAppActivationDependencies> = {},
): DesktopAppActivationDependencies {
  return {
    getTarget: () => ({ environmentId, platform: "linux" }),
    findProject: () => ({
      id: existingProjectId,
      environmentId,
      workspaceRoot: request.workspaceRoot,
    }),
    createProject: vi.fn(async () => createdProjectId),
    waitForProject: vi.fn(async () => undefined),
    openThread: vi.fn(async () => ({ threadId })),
    ...overrides,
  };
}

describe("desktop app activation", () => {
  it("reuses an existing project and opens a new thread", async () => {
    const deps = dependencies();

    const response = await handleDesktopAppActivationRequest(request, deps);

    expect(deps.createProject).not.toHaveBeenCalled();
    expect(deps.openThread).toHaveBeenCalledWith({ environmentId, projectId: existingProjectId });
    expect(response).toEqual({
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId: existingProjectId,
      threadId,
    });
  });

  it("waits for a created project before it opens the thread", async () => {
    const order: string[] = [];
    const deps = dependencies({
      findProject: () => null,
      createProject: vi.fn(async () => {
        order.push("create");
        return createdProjectId;
      }),
      waitForProject: vi.fn(async () => {
        order.push("project-event");
      }),
      openThread: vi.fn(async () => {
        order.push("open-thread");
        return { threadId };
      }),
    });

    const response = await handleDesktopAppActivationRequest(request, deps);

    expect(order).toEqual(["create", "project-event", "open-thread"]);
    expect(response).toMatchObject({ ok: true, projectId: createdProjectId });
  });

  it("rejects a Windows path when the primary environment is WSL", async () => {
    const response = await handleDesktopAppActivationRequest(
      { ...request, platform: "win32" },
      dependencies({ getTarget: () => ({ environmentId, platform: "linux" }) }),
    );

    expect(response).toMatchObject({ ok: false, code: "platform-mismatch" });
  });

  it("returns a project error without opening a thread", async () => {
    const openThread = vi.fn(async () => ({ threadId }));
    const response = await handleDesktopAppActivationRequest(
      request,
      dependencies({
        findProject: () => null,
        createProject: vi.fn(async () => {
          throw new Error("Project path is not available.");
        }),
        openThread,
      }),
    );

    expect(response).toMatchObject({
      ok: false,
      code: "project-create-failed",
      message: "Project path is not available.",
    });
    expect(openThread).not.toHaveBeenCalled();
  });
});

describe("desktop connection registration", () => {
  const connectionRequest = {
    version: 1,
    requestId: "connection-request",
    type: "add-connection",
    pairingUrl: "https://remote.example/pair#token=secret-token",
  } as const;

  it("acknowledges only after registration finishes", async () => {
    let finishRegistration = (_environmentId: EnvironmentId) => {};
    const registration = new Promise<EnvironmentId>((resolve) => {
      finishRegistration = resolve;
    });
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let completed = false;
    const response = handleDesktopAppConnectionRequest(connectionRequest, async () => {
      markStarted();
      return AsyncResult.success(await registration);
    }).then((value) => {
      completed = true;
      return value;
    });
    await started;
    expect(completed).toBe(false);
    finishRegistration(environmentId);
    await expect(response).resolves.toEqual({
      version: 1,
      requestId: connectionRequest.requestId,
      ok: true,
      result: "connection-added",
      environmentId,
    });
  });

  it.each([
    {
      error: new ConnectionBlockedError({
        reason: "configuration",
        detail: "Failed fetching secret-token",
      }),
      code: "pairing-failed",
    },
    {
      error: new Persistence.ConnectionPersistenceError({
        operation: "register-connection",
        message: "Could not save secret-token",
      }),
      code: "connection-save-failed",
    },
  ])("returns $code without exposing credentials", async ({ error, code }) => {
    const response = await handleDesktopAppConnectionRequest(connectionRequest, async () =>
      AsyncResult.failure(Cause.fail(error)),
    );
    expect(response).toMatchObject({ ok: false, code });
    expect(JSON.stringify(response)).not.toContain("secret-token");
  });
  it("reports unexpected defects without exposing their payload", async () => {
    const response = await handleDesktopAppConnectionRequest(connectionRequest, async () =>
      AsyncResult.failure(Cause.die(new Error("secret-token"))),
    );
    expect(response).toMatchObject({ ok: false, code: "internal-error" });
    expect(JSON.stringify(response)).not.toContain("secret-token");
  });
});

describe("desktop activation runner", () => {
  const success = {
    version: 1,
    requestId: request.requestId,
    ok: true,
    projectId: existingProjectId,
    threadId,
  } as const;

  it("rejects concurrent work while an earlier operation is still running", async () => {
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const run = createDesktopAppActivationRunner();
    const complete = vi.fn(async () => {});
    const process = vi.fn(async () => {
      await pending;
      return success;
    });
    const first = run(request, process, complete);
    await run({ ...request, requestId: "request-2" }, process, complete);
    expect(process).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "request-2", ok: false, code: "request-busy" }),
    );
    finish();
    await first;
    expect(complete).toHaveBeenLastCalledWith(success);
  });

  it("completes a rejected operation as an internal error without exposing its payload", async () => {
    const run = createDesktopAppActivationRunner();
    const complete = vi.fn(async () => {});
    await run(
      request,
      async () => {
        throw new Error("secret-token");
      },
      complete,
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: request.requestId, ok: false, code: "internal-error" }),
    );
    expect(JSON.stringify(complete.mock.calls)).not.toContain("secret-token");
  });

  it("accepts new work after response delivery fails", async () => {
    const run = createDesktopAppActivationRunner();
    await expect(
      run(
        request,
        async () => success,
        async () => {
          throw new Error("Window closed");
        },
      ),
    ).rejects.toThrow("Window closed");
    const complete = vi.fn(async () => {});
    await run(request, async () => success, complete);
    expect(complete).toHaveBeenCalledWith(success);
  });
});
