import { describe, expect, it, vi } from "vite-plus/test";

import type { BranchToolbarHandle } from "../BranchToolbar";
import type { ChatComposerHandle } from "./ChatComposer";
import { composerShortcutCommands } from "./composerShortcuts";

function setup(availability: { draftProjectControls: boolean; branchPicker: boolean }) {
  const openControl = vi.fn();
  const openBranchPicker = vi.fn();
  const commands = composerShortcutCommands(
    { current: { openControl } as Partial<ChatComposerHandle> as ChatComposerHandle },
    {
      current: { openBranchPicker } as Partial<BranchToolbarHandle> as BranchToolbarHandle,
    },
    availability,
  );
  const run = (command: keyof typeof commands, repeat = false) =>
    commands[command]?.({ repeat, terminalFocusOwner: null });
  return { run, openControl, openBranchPicker };
}

describe("composerShortcutCommands", () => {
  it("lets draft project and branch chords through when their controls are hidden", () => {
    const { run, openControl, openBranchPicker } = setup({
      draftProjectControls: false,
      branchPicker: false,
    });
    expect(run("composer.host")).toBe(false);
    expect(run("composer.workspace")).toBe(false);
    expect(run("composer.branch")).toBe(false);
    run("composer.effort");
    expect(openControl).toHaveBeenCalledExactlyOnceWith("composer.effort");
    expect(openBranchPicker).not.toHaveBeenCalled();
  });

  it("opens available controls once per press, not on key repeat", () => {
    const { run, openControl, openBranchPicker } = setup({
      draftProjectControls: true,
      branchPicker: true,
    });
    run("composer.host");
    run("composer.host", true);
    run("composer.branch");
    expect(openControl).toHaveBeenCalledExactlyOnceWith("composer.host");
    expect(openBranchPicker).toHaveBeenCalledOnce();
  });
});
