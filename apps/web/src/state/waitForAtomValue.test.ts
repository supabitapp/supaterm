import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { waitForAtomValue } from "./waitForAtomValue";

describe("waitForAtomValue", () => {
  it("releases its subscription when a pending wait is cancelled", async () => {
    const registry = AtomRegistry.make();
    const atom = Atom.make("pending");
    const controller = new AbortController();
    const predicate = vi.fn((value: string) => value === "ready");
    const result = waitForAtomValue({
      registry,
      atom,
      predicate,
      signal: controller.signal,
    });

    controller.abort();
    await expect(result).resolves.toBe(false);
    predicate.mockClear();
    registry.set(atom, "ready");
    expect(predicate).not.toHaveBeenCalled();
    registry.dispose();
  });

  it("does not start an already-cancelled wait even if the thread is ready", async () => {
    const registry = AtomRegistry.make();
    const atom = Atom.make("ready");
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForAtomValue({
        registry,
        atom,
        predicate: (value) => value === "ready",
        signal: controller.signal,
      }),
    ).resolves.toBe(false);
    registry.dispose();
  });
});
