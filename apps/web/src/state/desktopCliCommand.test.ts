import type { DesktopCliCommandState } from "@supaterm/contracts";
import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { describe, expect, it, vi } from "vite-plus/test";

import { createDesktopCliCommandStateAtom } from "./desktopCliCommand";

describe("desktopCliCommandStateAtom", () => {
  it("reloads stale state when Settings mounts it again", async () => {
    const reads: Array<DesktopCliCommandState> = [];
    const getState = async () => {
      const state: DesktopCliCommandState = {
        supported: true,
        installedPath: null,
        onPath: false,
        launcherPath: null,
      };
      reads.push(state);
      return state;
    };
    const desktopCliCommandStateAtom = createDesktopCliCommandStateAtom(() => ({ getState }));
    vi.useFakeTimers({ toFake: ["Date"] });
    using _clock = { [Symbol.dispose]: () => vi.useRealTimers() };
    vi.setSystemTime(1_000_000);
    const registry = AtomRegistry.make();

    const unmountFirst = registry.mount(desktopCliCommandStateAtom);
    await vi.waitFor(() => {
      const result = registry.get(desktopCliCommandStateAtom);
      expect(AsyncResult.isInitial(result) || result.waiting).toBe(false);
    });
    unmountFirst();
    await vi.waitFor(() => expect(registry.getNodes().size).toBe(1));

    vi.setSystemTime(1_060_000);
    const unmountSecond = registry.mount(desktopCliCommandStateAtom);
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    unmountSecond();
    registry.dispose();
  });
});
