import {
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  EnvironmentId,
  ThreadId,
  type AuthSessionState,
} from "@supaterm/contracts";
import { EMPTY_TERMINAL_BUFFER_STATE } from "@supaterm/client-runtime/state/terminal";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  session: vi.fn(),
  attach: vi.fn(),
  observe: vi.fn(),
  metadata: vi.fn(),
}));
vi.mock("./terminal", () => ({ terminalEnvironment: fixture }));
vi.mock("./session", async (original) => ({
  ...(await original<typeof import("./session")>()),
  environmentSession: { sessionStateAtom: fixture.session },
}));

import { attachedTerminalSessionAtom } from "./terminalSessions";

it("attaches only with destination write access and falls back to read-only observation after revocation", () => {
  const session = Atom.make<
    AsyncResult.AsyncResult<Pick<AuthSessionState, "authenticated" | "scopes">, unknown>
  >(AsyncResult.success({ authenticated: true, scopes: [] }));
  fixture.session.mockReturnValue(session);
  fixture.attach.mockReturnValue(Atom.make(AsyncResult.success(EMPTY_TERMINAL_BUFFER_STATE)));
  fixture.observe.mockReturnValue(Atom.make(AsyncResult.success(EMPTY_TERMINAL_BUFFER_STATE)));
  fixture.metadata.mockReturnValue(Atom.make(AsyncResult.success([])));
  fixture.attach.mockClear();
  fixture.observe.mockClear();
  const registry = AtomRegistry.make();
  const environmentId = EnvironmentId.make("destination");
  const input = { threadId: ThreadId.make("thread"), terminalId: "terminal", cwd: "/workspace" };
  const terminal = attachedTerminalSessionAtom(environmentId, input);
  registry.get(terminal);
  expect(fixture.attach).not.toHaveBeenCalled();
  expect(fixture.observe).not.toHaveBeenCalled();

  registry.set(
    session,
    AsyncResult.success({
      authenticated: true,
      scopes: [AuthTerminalReadScope, AuthTerminalOperateScope],
    }),
  );
  registry.get(terminal);
  expect(fixture.attach).toHaveBeenCalledWith({ environmentId, input });
  fixture.attach.mockClear();
  registry.set(
    session,
    AsyncResult.success({ authenticated: true, scopes: [AuthTerminalReadScope] }),
  );
  registry.get(terminal);
  expect(fixture.attach).not.toHaveBeenCalled();
  expect(fixture.observe).toHaveBeenCalledWith({
    environmentId,
    input: { threadId: input.threadId, terminalId: input.terminalId },
  });

  fixture.observe.mockClear();
  registry.set(session, AsyncResult.success({ authenticated: true, scopes: [] }));
  registry.get(terminal);
  expect(fixture.observe).not.toHaveBeenCalled();
  registry.dispose();
});
