import { compileResolvedKeybindingsConfig, isMacPlatform } from "@supaterm/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const state = vi.hoisted(() => ({ navigate: fake() }));

const MOD = isMacPlatform(navigator.platform) ? "Meta" : "Control";

const keybindings = compileResolvedKeybindingsConfig([
  { key: "mod+u", command: "navigation.back", when: "usagePageOpen" },
  { key: "mod+u", command: "usage.open", when: "!usagePageOpen" },
]);

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => keybindings) as never,
}));
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig: compile } =
    await import("@supaterm/shared/keybindings");
  const compiled = compile([
    { key: "mod+u", command: "navigation.back", when: "usagePageOpen" },
    { key: "mod+u", command: "usage.open", when: "!usagePageOpen" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(compiled) };
});
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));

import { useCommandPaletteMount } from "../commandPaletteStore";
import { installCommandPaletteCommands } from "../shortcuts/commandPaletteCommands";
import { registerNavigationHistoryCommands } from "./AppSidebarLayout";

function MountedPalette() {
  useCommandPaletteMount();
  return null;
}

describe("usage toggle shortcut on Usage", () => {
  it("goes back", async () => {
    vi.clearAllMocks();
    await using screen = await render(null, { router: "/usage" });
    const history = { navigate: (_direction: "back" | "forward") => {} };
    const navigate = vi.spyOn(history, "navigate");
    using _commands = {
      [Symbol.dispose]: registerNavigationHistoryCommands(screen.router!, history.navigate),
    };

    await userEvent.keyboard(`{${MOD}>}u{/${MOD}}`);

    expect(navigate).toHaveBeenCalledExactlyOnceWith("back");
  });

  it("does not reopen Usage from the command palette", async () => {
    vi.clearAllMocks();
    await using screen = await render(<MountedPalette />, { router: "/usage" });
    using navigate = vi.spyOn(screen.router!, "navigate");
    using commands = new DisposableStack();
    commands.defer(
      installCommandPaletteCommands(screen.router!, { keybindings: () => keybindings }),
    );

    await userEvent.keyboard(`{${MOD}>}u{/${MOD}}`);

    expect(navigate).not.toHaveBeenCalled();
  });
});
