import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@supaterm/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createThreadDetailReadiness } from "./threadDetailReadiness";
import { makeThreadFixture } from "../thread.fixture";

const stores = vi.hoisted(() => ({
  loaded: false,
  pending: new Map<string, { status: string }>(),
  drafts: new Set<string>(),
  outboxListeners: new Set<() => void>(),
  draftListeners: new Set<() => void>(),
}));

vi.mock("./threadOutbox", () => ({
  webThreadOutbox: {
    isLoaded: () => stores.loaded,
    subscribe: (listener: () => void) => {
      stores.outboxListeners.add(listener);
      return () => stores.outboxListeners.delete(listener);
    },
  },
  readPendingThreadCreation: (ref: ScopedThreadRef) =>
    stores.pending.get(scopedThreadKey(ref)) ?? null,
}));

vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: {
    getState: () => ({
      getDraftSessionByRef: (ref: ScopedThreadRef) =>
        stores.drafts.has(scopedThreadKey(ref)) ? {} : null,
    }),
    subscribe: (listener: () => void) => {
      stores.draftListeners.add(listener);
      return () => stores.draftListeners.delete(listener);
    },
  },
}));

const ref = { environmentId: EnvironmentId.make("environment"), threadId: ThreadId.make("thread") };
let registry: AtomRegistry.AtomRegistry;

beforeEach(() => {
  stores.loaded = false;
  stores.pending.clear();
  stores.drafts.clear();
  registry = AtomRegistry.make();
});

afterEach(() => {
  registry.dispose();
  expect(stores.outboxListeners.size).toBe(0);
  expect(stores.draftListeners.size).toBe(0);
});

function harness() {
  const shells = Atom.family((_key: string) => Atom.make<EnvironmentThreadShell | null>(null));
  const ready = createThreadDetailReadiness((target) => shells(scopedThreadKey(target)));
  const atom = ready(ref);
  registry.mount(atom);
  return {
    atom,
    ready,
    confirm: () =>
      registry.set(
        shells(scopedThreadKey(ref)),
        makeThreadFixture({ environmentId: ref.environmentId, id: ref.threadId }),
      ),
    notify: () => {
      for (const listener of stores.outboxListeners) listener();
      for (const listener of stores.draftListeners) listener();
    },
  };
}

describe("thread detail readiness", () => {
  it("waits for persisted pending creations to load before resolving an unknown thread", () => {
    const h = harness();
    expect(registry.get(h.atom)).toBe(false);
    stores.pending.set(scopedThreadKey(ref), { status: "pending" });
    stores.loaded = true;
    h.notify();
    expect(registry.get(h.atom)).toBe(false);
    stores.pending.set(scopedThreadKey(ref), { status: "delivered" });
    h.notify();
    expect(registry.get(h.atom)).toBe(true);
  });

  it("starts reading when the server confirms creation before delivery returns", () => {
    stores.loaded = true;
    stores.pending.set(scopedThreadKey(ref), { status: "pending" });
    const h = harness();
    expect(registry.get(h.atom)).toBe(false);
    h.confirm();
    expect(registry.get(h.atom)).toBe(true);
    expect(stores.outboxListeners.size).toBe(0);
    expect(stores.draftListeners.size).toBe(0);
  });

  it("keeps rejected creations blocked and accepts unknown deep links after hydration", () => {
    stores.loaded = true;
    stores.pending.set(scopedThreadKey(ref), { status: "failed" });
    const h = harness();
    expect(registry.get(h.atom)).toBe(false);
    const unknown = { ...ref, threadId: ThreadId.make("unknown") };
    expect(registry.get(h.ready(unknown))).toBe(true);
  });

  it("keeps unsent drafts blocked and isolates the same thread ID across environments", () => {
    stores.loaded = true;
    stores.drafts.add(scopedThreadKey(ref));
    const h = harness();
    expect(registry.get(h.atom)).toBe(false);
    expect(registry.get(h.ready({ ...ref, environmentId: EnvironmentId.make("other") }))).toBe(
      true,
    );
    stores.drafts.delete(scopedThreadKey(ref));
    h.notify();
    expect(registry.get(h.atom)).toBe(true);
  });

  it("does not restart a ready consumer on unrelated outbox changes", () => {
    stores.loaded = true;
    const h = harness();
    let starts = 0;
    const consumer = Atom.make((get) => {
      if (get(h.atom)) starts += 1;
    });
    registry.mount(consumer);
    expect(starts).toBe(1);
    stores.pending.set("other:thread", { status: "pending" });
    h.notify();
    expect(starts).toBe(1);
  });
});
