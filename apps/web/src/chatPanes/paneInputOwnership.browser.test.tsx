import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { act, render as renderUi, type Screen } from "../../test/render";
import { describe, expect, it } from "vite-plus/test";

import { dispatchAppCommand } from "../appCommandBus";
import { useChatShortcuts } from "../components/chat/useChatShortcuts";
import { PaneScopeProvider, usePaneInputOwner } from "./paneScope";
import { useChatPaneStore } from "./store";

let screen: Screen;

async function setupTest() {
  await using resources = new AsyncDisposableStack();
  resources.defer(() => {
    useChatPaneStore.setState({ layout: null, closed: [], openToSide: null });
  });

  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

function PaneShortcuts({ onFind }: { onFind: () => void }) {
  const isInputOwner = usePaneInputOwner();
  useChatShortcuts({
    enabled: true,
    isInputOwner,
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    scriptKeybindings: [],
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
      modelPickerOpen: false,
    }),
    threadFindActive: false,
    composerRef: { current: null },
    branchToolbarRef: { current: null },
    composerShortcutAvailability: { draftProjectControls: true, branchPicker: true },
    closeThreadFind: () => {},
    commands: { "chat.find": () => onFind() },
    fallback: () => undefined,
  });
  return null;
}

const thread = (id: string) => ({
  kind: "server" as const,
  threadRef: { environmentId: "env" as EnvironmentId, threadId: id as ThreadId },
});

describe("chat shortcuts in a split", () => {
  it.each(["keyboard", "command"])("run only in the focused pane via %s", async (input) => {
    await using _test = await setupTest();
    const store = useChatPaneStore.getState();
    store.reconcileRoute(thread("a"), { width: 1600, height: 900 });
    const first = useChatPaneStore.getState().layout!.focusedPaneId;
    const second = store.split(first, "right", thread("b"))!;
    const found: string[] = [];
    const scope = (paneId: string) => ({
      paneId,
      layoutVersion: paneId,
      narrow: false,
      collapsed: false,
      element: null,
    });
    await screen.rerender(
      <>
        <PaneScopeProvider value={scope(first)}>
          <PaneShortcuts onFind={() => found.push("first")} />
        </PaneScopeProvider>
        <PaneScopeProvider value={scope(second)}>
          <PaneShortcuts onFind={() => found.push("second")} />
        </PaneScopeProvider>
      </>,
    );
    const pressFind = () =>
      input === "command"
        ? dispatchAppCommand("chat.find")
        : window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "f",
              code: "KeyF",
              metaKey: navigator.platform.includes("Mac"),
              ctrlKey: !navigator.platform.includes("Mac"),
              bubbles: true,
              cancelable: true,
            }),
          );

    pressFind();
    expect(found).toEqual(["second"]);

    await act(() => useChatPaneStore.getState().focus(first));
    pressFind();
    expect(found).toEqual(["second", "first"]);
  });
});
