import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../test/render";
import { RightPanelTabs } from "./RightPanelTabs";

it("waits for IME composition to end before Enter renames a device tab", async () => {
  const onRenameDevice = vi.fn();
  const noop = () => {};
  await using _screen = await render(
    <RightPanelTabs
      mode="sidebar"
      keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
      getShortcutContext={() => ({
        terminalFocus: false,
        terminalOpen: false,
        previewFocus: false,
        previewOpen: false,
        isWeb: true,
        isDesktop: false,
      })}
      surfaces={[{ id: "device", kind: "device", title: "Phone" }]}
      environmentId={null}
      activeSurfaceId="device"
      pendingSurfaceIds={new Set()}
      previewSessions={{}}
      desktopByTabId={{}}
      terminalLabelsById={new Map()}
      onActivate={noop}
      onRenameDevice={onRenameDevice}
      onCloseSurface={noop}
      onCloseOtherSurfaces={noop}
      onCloseSurfacesToRight={noop}
      onCloseAllSurfaces={noop}
      onCopyFilePath={noop}
      onAddBrowser={noop}
      onAddBrowserInProfile={noop}
      onAddTerminal={noop}
      onAddDiff={noop}
      onAddFiles={noop}
      onAddPullRequest={noop}
      onAddPullRequests={noop}
      onAddDevice={noop}
      browserAvailable={false}
      terminalAvailable={false}
      diffAvailable={false}
      filesAvailable={false}
      pullRequestAvailable={false}
      pullRequestsAvailable={false}
      deviceAvailable
    >
      {null}
    </RightPanelTabs>,
  );
  await userEvent.dblClick(page.getByRole("button", { name: "Phone" }));
  const name = page.getByRole("textbox", { name: "Device tab name" });
  await name.fill("電話");

  for (const composition of [
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
  ]) {
    const event = new KeyboardEvent("keydown", { key: "Enter", ...composition, bubbles: true });
    await act(() => name.element().dispatchEvent(event));
    expect(onRenameDevice, JSON.stringify(composition)).not.toHaveBeenCalled();
  }

  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(onRenameDevice).toHaveBeenCalledWith("device", "電話"));
});
