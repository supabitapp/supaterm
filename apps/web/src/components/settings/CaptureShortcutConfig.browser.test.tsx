import {
  DEFAULT_CLIENT_SETTINGS,
  type DesktopCaptureConfigPreview,
  type DesktopSnapShotState,
} from "@supaterm/contracts";
import { userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

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
const bridge = vi.hoisted(() => ({
  previewSnapShotConfig: fake(),
  applySnapShotConfig: fake(),
  setSnapShotShortcutSuppressed: fake(),
}));
const toast = vi.hoisted(() => fake());
vi.mock(import("../../lib/desktopSnapShot"), async (original) => ({
  ...(await original()),
  getDesktopSnapShotBridge: () => bridge as never,
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: toast as never } };
});

import {
  formatSnapShotShortcutLabel,
  parseDesktopSnapShotShortcut,
} from "../../lib/snapShotShortcut";
import { CaptureShortcutConfig } from "./CaptureShortcutConfig";

const preview: DesktopCaptureConfigPreview = {
  id: "approved-snapshot",
  path: "/config/niri/config.kdl",
  resolvedPath: "/config/niri/config.kdl",
  before: "binds {\n}\n",
  after: 'binds {\n    Ctrl+Shift+2 { spawn "gdbus"; }\n}\n',
  shortcut: "Ctrl+Shift+2",
  operation: "install",
};
const complete = fake<() => Promise<void>>();
const recorderLabel = `Record snapshot shortcut, currently ${formatSnapShotShortcutLabel(
  parseDesktopSnapShotShortcut("Ctrl+Shift+2")!,
)}`;

function setup() {
  bridge.setSnapShotShortcutSuppressed.reset(async () => undefined);
  bridge.previewSnapShotConfig.reset(async () => preview);
  bridge.applySnapShotConfig.reset(async () => ({ backupPath: "/config/backup", warning: null }));
  complete.reset(async () => undefined);
  toast.mockClear();
  return { [Symbol.dispose]: () => {} };
}

async function renderConfig(desktop: "niri" | "hyprland" = "niri") {
  const state: DesktopSnapShotState = {
    mode: "portal",
    linuxBackend: desktop,
    shortcut: DEFAULT_CLIENT_SETTINGS.snapShotShortcut,
    shortcutRegistered: false,
    shortcutActionRegistered: true,
    shortcutMessage: null,
    message: null,
    shortcutConfigPath: preview.path,
    shortcutBinding: "manual binding",
  };
  const screen = await render(<CaptureShortcutConfig state={state} onComplete={complete} />);
  const { container } = screen;
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((element) => element.textContent === label);
  const recorder = () => container.querySelector<HTMLButtonElement>("[data-keybinding-capture]")!;
  return Object.assign(screen, {
    button,
    recorder,
    diff: () => container.querySelector('[aria-label="Shortcut changes"]'),
    alert: () => container.querySelector('[role="alert"]'),
    advanced: () => container.querySelector("details")!,
    async click(label: string) {
      const target = button(label);
      expect(target, `button ${label}`).toBeDefined();
      await act(async () => target!.click());
    },
    async recordKeys(keys: string) {
      await userEvent.click(recorder());
      await userEvent.keyboard(keys);
    },
  });
}

it.each(["niri", "hyprland"] as const)(
  "shows the fallback before review and requires separate read and write approval on %s",
  async (desktop) => {
    using _env = setup();
    await using screen = await renderConfig(desktop);
    expect(screen.recorder().getAttribute("aria-label")).toBe(recorderLabel);
    expect(screen.advanced().textContent).toContain("manual binding");
    expect(bridge.previewSnapShotConfig).not.toHaveBeenCalled();
    await screen.click("Review changes");
    expect(screen.recorder().getAttribute("aria-label")).toBe(recorderLabel);
    expect(bridge.applySnapShotConfig).not.toHaveBeenCalled();
    expect(screen.diff()).not.toBeNull();
    await screen.click("Save shortcut");
    expect(bridge.applySnapShotConfig).toHaveBeenCalledExactlyOnceWith(preview.id);
    expect(complete).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  },
);

it("withdraws a stale diff and requires another read instead of retrying its write", async () => {
  using _env = setup();
  await using screen = await renderConfig();
  await screen.click("Review changes");
  bridge.applySnapShotConfig.implement(async () =>
    Promise.reject(new Error("Your config changed since this preview.")),
  );
  await screen.click("Save shortcut");
  expect(screen.alert()?.textContent).toContain("Review the changes and try again");
  expect(screen.advanced().textContent).toContain("Your config changed since this preview.");
  expect(screen.button("Review changes")).toBeDefined();
  expect(screen.diff()).toBeNull();
  expect(complete).not.toHaveBeenCalled();
});
