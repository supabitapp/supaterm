import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  type AuthSessionState,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const harness = await vi.hoisted(async () => {
  const { Atom, AtomRegistry, AsyncResult } = await import("effect/reactivity");
  return {
    registry: AtomRegistry.make(),
    phases: Atom.family((_id: string) => Atom.make<"connected" | "offline" | null>("connected")),
    sessions: Atom.family((_id: string) =>
      Atom.make<AsyncResult.AsyncResult<AuthSessionState, Error>>(AsyncResult.initial()),
    ),
  };
});

vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: harness.registry }));
vi.mock("./session", () => ({ environmentSession: { sessionStateAtom: harness.sessions } }));
vi.mock("./presentation", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentPresentations: {
      presentationAtom: Atom.family((id: string) =>
        Atom.make((get) => {
          const phase = get(harness.phases(id));
          return phase === null ? null : { connection: { phase } };
        }),
      ),
    },
  };
});

import { canQueueComposerMessageAtom, readCanQueueComposerMessage } from "./composerQueue";

const environmentId = EnvironmentId.make("queue-environment");
const session = (allowed: boolean): AuthSessionState => ({
  authenticated: true,
  scopes: allowed ? [AuthOrchestrationOperateScope] : [],
  auth: {
    policy: "loopback-browser",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "session",
  },
});

afterEach(() => harness.registry.reset());

describe("composer queue permission", () => {
  it("allows offline saving with unknown access, then observes a denial on reconnect", () => {
    const atom = canQueueComposerMessageAtom(environmentId);
    harness.registry.mount(atom);
    expect(harness.registry.get(atom)).toBe(false);
    harness.registry.set(harness.phases(environmentId), "offline");
    expect(harness.registry.get(atom)).toBe(true);
    expect(readCanQueueComposerMessage(environmentId)).toBe(true);
    harness.registry.set(harness.phases(environmentId), "connected");
    harness.registry.set(harness.sessions(environmentId), AsyncResult.success(session(false)));
    expect(harness.registry.get(atom)).toBe(false);
    expect(readCanQueueComposerMessage(environmentId)).toBe(false);
    harness.registry.set(harness.sessions(environmentId), AsyncResult.success(session(true)));
    expect(harness.registry.get(atom)).toBe(true);
  });

  it("does not treat a disconnected permission lookup failure as a denial", () => {
    harness.registry.set(
      harness.sessions(environmentId),
      AsyncResult.failure(Cause.fail(new Error("Disconnected"))),
    );
    expect(readCanQueueComposerMessage(environmentId)).toBe(false);
    harness.registry.set(harness.phases(environmentId), "offline");
    expect(readCanQueueComposerMessage(environmentId)).toBe(true);
  });

  it("keeps a known denial blocked while offline without borrowing another environment's access", () => {
    harness.registry.set(harness.phases(environmentId), "offline");
    harness.registry.set(harness.sessions(environmentId), AsyncResult.success(session(false)));
    const other = EnvironmentId.make("other-environment");
    harness.registry.set(harness.sessions(other), AsyncResult.success(session(true)));
    expect(readCanQueueComposerMessage(other)).toBe(true);
    expect(readCanQueueComposerMessage(environmentId)).toBe(false);
  });

  it("does not queue to a removed environment", () => {
    harness.registry.set(harness.phases(environmentId), null);
    expect(readCanQueueComposerMessage(environmentId)).toBe(false);
  });
});
