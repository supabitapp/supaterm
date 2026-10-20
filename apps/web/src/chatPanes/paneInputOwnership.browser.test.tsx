import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useChatShortcuts } from "../components/chat/useChatShortcuts";
import { PaneScopeProvider, usePaneInputOwner } from "./paneScope";
import { useChatPaneStore } from "./store";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useChatPaneStore.setState({ layout: null, closed: [], openToSide: null });
  vi.unstubAllGlobals();
});

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
    typeIntoComposer: () => false,
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
  it("run only in the focused pane", async () => {
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
    });
    await act(() =>
      root.render(
        <>
          <PaneScopeProvider value={scope(first)}>
            <PaneShortcuts onFind={() => found.push("first")} />
          </PaneScopeProvider>
          <PaneScopeProvider value={scope(second)}>
            <PaneShortcuts onFind={() => found.push("second")} />
          </PaneScopeProvider>
        </>,
      ),
    );
    const pressFind = () =>
      window.dispatchEvent(
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

    act(() => useChatPaneStore.getState().focus(first));
    pressFind();
    expect(found).toEqual(["second", "first"]);
  });
});
