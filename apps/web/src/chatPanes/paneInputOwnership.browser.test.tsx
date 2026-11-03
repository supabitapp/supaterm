import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { act, render as renderUi, type Screen } from "../../test/render";
import { describe, expect, it } from "vite-plus/test";

import { useChatShortcuts } from "../components/chat/useChatShortcuts";
import { dispatchMenuAction, runCommand } from "../shortcuts/dispatcher";
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

const scope = (paneId: string, layoutVersion = paneId) => ({
  paneId,
  layoutVersion,
  narrow: false,
  collapsed: false,
  element: null,
});

function splitPanes() {
  const store = useChatPaneStore.getState();
  store.reconcileRoute(thread("a"), { width: 1600, height: 900 });
  const first = useChatPaneStore.getState().layout!.focusedPaneId;
  const second = store.split(first, "right", thread("b"), null)!;
  return { first, second };
}

function OwnershipCheck({ onRender }: { onRender: (check: () => boolean) => void }) {
  onRender(usePaneInputOwner());
  return null;
}

describe("pane input ownership check", () => {
  it("stays one function across rerenders and reads the focused pane when called", async () => {
    await using _test = await setupTest();
    const { first, second } = splitPanes();
    const checks = new Set<() => boolean>();
    const element = (layoutVersion: string) => (
      <PaneScopeProvider value={scope(second, layoutVersion)}>
        <OwnershipCheck onRender={(check) => checks.add(check)} />
      </PaneScopeProvider>
    );
    await screen.rerender(element("before"));
    await screen.rerender(element("after"));
    expect(checks.size).toBe(1);
    const [check] = checks;
    expect(check!()).toBe(true);

    await act(() => useChatPaneStore.getState().focus(first));
    expect(check!()).toBe(false);
  });
});

describe("chat shortcuts in a split", () => {
  it.each(["keyboard", "device", "menu"])("run only in the focused pane via %s", async (input) => {
    await using _test = await setupTest();
    const { first, second } = splitPanes();
    const found: string[] = [];
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
      input === "device"
        ? runCommand("chat.find", "device")
        : input === "menu"
          ? dispatchMenuAction("chat.find")
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
