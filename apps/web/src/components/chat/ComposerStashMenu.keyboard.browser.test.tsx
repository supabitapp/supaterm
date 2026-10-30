import { useRef, useState } from "react";
import { expect, it } from "vite-plus/test";
import { EnvironmentId } from "@supaterm/contracts";
import { mergeWithDefaultKeybindings } from "@supaterm/shared/keybindings";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { Dialog, DialogPopup } from "../ui/dialog";
import { ComposerStashMenu } from "./ComposerStashMenu";
import { isMacPlatform } from "../../lib/utils";
import { useComposerStash } from "./useComposerStash";
import { DraftId, useComposerThreadDraft } from "../../composerDraftStore";
import { PaneScopeProvider, usePaneInputOwner } from "../../chatPanes/paneScope";
import { useChatPaneStore } from "../../chatPanes/store";
import { usePromptStashStore } from "../../promptStashStore";

function Composer({ dialog = false }: { dialog?: boolean }) {
  const composerFormRef = useRef<HTMLFormElement>(null);
  const [entries, setEntries] = useState(
    ["first", "second"].map((id) => ({
      id,
      createdAt: "2026-10-01T00:00:00.000Z",
      prompt: `${id} prompt`,
      attachments: [],
      droppedImageNames: [],
    })),
  );
  const [draft, setDraft] = useState("Unsent draft");
  const [open, setOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(dialog);
  const [answer, setAnswer] = useState<string | null>(null);
  return (
    <>
      <form ref={composerFormRef}>
        <textarea
          aria-label="Message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" onClick={() => setAnswer("Continue")}>
          Continue
        </button>
        <p role="status">{answer ? `Selected: ${answer}` : "Choose an answer"}</p>
      </form>
      <input aria-label="Search threads" />
      <button onClick={() => setOpen(true)}>Open stash</button>
      {open && (
        <ComposerStashMenu
          composerFormRef={composerFormRef}
          entries={entries}
          sendAllBlockedReason={null}
          onSendAll={() => {}}
          stashShortcutLabel="Ctrl+S"
          onRestore={(entry) => {
            setDraft(entry.prompt);
            setEntries((current) => current.filter(({ id }) => id !== entry.id));
            setOpen(false);
          }}
          onDelete={(entry) => {
            setEntries((current) => current.filter(({ id }) => id !== entry.id));
            if (entries.length === 1) setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogPopup aria-label="Command palette">
          <input aria-label="Search commands" />
        </DialogPopup>
      </Dialog>
    </>
  );
}

const editor = () => page.getByRole("textbox", { name: "Message" });
const stash = () => page.getByRole("list", { name: "Stashed prompts" });
const restore = (prompt: string) =>
  page.getByRole("button", { name: `Restore stashed prompt: ${prompt}` });
const press = (keys: string) => userEvent.keyboard(keys);
const focus = (element: Element) => act(async () => (element as HTMLElement).focus());

it("leaves dialog, unrelated input and question button shortcuts alone while the stash is open", async () => {
  await using _screen = await render(<Composer dialog />);
  const input = page.getByRole("textbox", { name: "Search commands" }).element();
  await focus(input);

  for (const key of [
    { key: "ArrowDown" },
    { key: "ArrowUp" },
    { key: "Enter" },
    { key: "Backspace", ctrlKey: true },
    { key: "Backspace", metaKey: true },
  ]) {
    const event = new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true });
    await act(async () => {
      input.dispatchEvent(event);
    });
    expect(event.defaultPrevented, key.key).toBe(false);
  }

  await press("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(stash().element().textContent).toContain("first prompt");
  expect(stash().element().textContent).toContain("second prompt");
  await expect.element(editor()).toHaveValue("Unsent draft");

  await focus(page.getByRole("textbox", { name: "Search threads" }).element());
  await press("{ArrowDown}{Enter}{Control>}{Backspace}{/Control}{Meta>}{Backspace}{/Meta}{Escape}");
  expect(stash().element().textContent).toContain("first prompt");
  expect(stash().element().textContent).toContain("second prompt");
  await expect.element(editor()).toHaveValue("Unsent draft");

  await focus(page.getByRole("button", { name: "Continue", exact: true }).element());
  await press("{Enter}");
  expect(page.getByRole("status").element().textContent).toBe("Selected: Continue");
  expect(stash().element().textContent).toContain("first prompt");
  expect(stash().element().textContent).toContain("second prompt");
  await press("{Control>}{Backspace}{/Control}{Meta>}{Backspace}{/Meta}");
  expect(stash().element().textContent).toContain("first prompt");
  expect(stash().element().textContent).toContain("second prompt");
  await expect.element(editor()).toHaveValue("Unsent draft");
});

it("navigates, deletes and restores stashed prompts from the composer and drawer", async () => {
  await using _screen = await render(<Composer />);
  await focus(restore("first prompt").element());
  await press("{ArrowDown}");
  await expect.element(restore("second prompt")).toHaveFocus();
  await press("{ArrowUp}");
  await expect.element(restore("first prompt")).toHaveFocus();

  await press("{Control>}{Backspace}{/Control}");
  await expect.element(restore("first prompt")).not.toBeInTheDocument();
  expect(stash().element().textContent).toContain("second prompt");
  await expect.element(editor()).toHaveValue("Unsent draft");
  expect(document.activeElement).toBe(document.body);

  await press("{Escape}");
  await expect.element(stash()).not.toBeInTheDocument();

  await userEvent.click(page.getByRole("button", { name: "Open stash" }));
  await expect.element(restore("first prompt")).not.toBeInTheDocument();
  expect(stash().element().textContent).toContain("second prompt");
  await focus(editor().element());
  await press("{ArrowDown}{Enter}");
  await expect.element(editor()).toHaveValue("second prompt");
  await expect.element(stash()).not.toBeInTheDocument();
});

function OwnedStash() {
  const draftId = DraftId.make("stash-ownership");
  const composerDraft = useComposerThreadDraft(draftId);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const promptRef = useRef("");
  const composerEditorRef = useRef(null);
  const { isStashMenuOpen, toggleStashMenuStable, setIsStashMenuOpen } = useComposerStash({
    environmentId: EnvironmentId.make("stash-environment"),
    readAttachments: () => composerDraft,
    composerDraftTarget: draftId,
    attachmentDraftTarget: draftId,
    composerDraft,
    promptRef,
    keybindings: mergeWithDefaultKeybindings([]),
    terminalOpen: false,
    isPaneInputOwner: usePaneInputOwner(),
    routeKind: "draft",
    projectSelectionRequired: false,
    isRevertingCheckpoint: false,
    isEditingQueuedMessage: false,
    pendingUserInputs: [],
    activePendingProgress: null,
    canQueueMessage: true,
    canQueueSelectedProvider: true,
    isSendBusy: false,
    isConnecting: false,
    sendDisabledReason: null,
    prompt: "",
    composerMenuOpen: false,
    isComposerModelPickerOpen: false,
    isComposerCollapsedMobile: false,
    composerPreviewAnnotations: [],
    composerReviewComments: [],
    composerThreadContexts: [],
    composerEnvironmentContexts: [],
    attachmentTargetKeyRef: useRef("stash-ownership"),
    composerDraftTargetKeyRef: useRef("stash-ownership"),
    composerEditorRef,
    isRevertingCheckpointRef: useRef(false),
    pendingThreadImportsRef: useRef(new Map()),
    setComposerCursor: () => {},
    setComposerTrigger: () => {},
    importContextRecords: () => new Map(),
    expandMobileComposer: () => {},
    submitComposer: () => null,
  });
  return (
    <>
      <form ref={composerFormRef} />
      <button onClick={toggleStashMenuStable}>Toggle stash</button>
      {isStashMenuOpen && (
        <ComposerStashMenu
          entries={[]}
          stashShortcutLabel={null}
          sendAllBlockedReason={null}
          composerFormRef={composerFormRef}
          onRestore={() => {}}
          onDelete={() => {}}
          onSendAll={() => {}}
          onClose={() => setIsStashMenuOpen(false)}
        />
      )}
    </>
  );
}

it("closes the owned stash on pane focus loss and permits a fresh keyboard reopen", async () => {
  const previous = useChatPaneStore.getState().layout;
  const previousEntries = usePromptStashStore.getState().entries;
  using _state = {
    [Symbol.dispose]() {
      useChatPaneStore.setState({ layout: previous });
      usePromptStashStore.setState({ entries: previousEntries });
    },
  };
  usePromptStashStore.setState({ entries: [] });
  useChatPaneStore.setState({
    layout: {
      columns: [
        { id: "left", size: 50 },
        { id: "right", size: 50 },
      ],
      rows: [{ id: "row", size: 100 }],
      cells: ["first", "second"].map((id, column) => ({
        id,
        column,
        columnSpan: 1,
        row: 0,
        rowSpan: 1,
        target: { kind: "draft", draftId: DraftId.make(id) },
      })),
      focusedPaneId: "first",
    },
  });
  await using screen = await render(
    <PaneScopeProvider
      value={{
        paneId: "first",
        layoutVersion: "1",
        narrow: false,
        collapsed: false,
        element: null,
      }}
    >
      <OwnedStash />
    </PaneScopeProvider>,
  );
  await screen.getByRole("button", { name: "Toggle stash" }).click();
  await expect.element(stash()).toBeInTheDocument();
  await act(() => useChatPaneStore.getState().focus("second"));
  await expect.element(stash()).not.toBeInTheDocument();
  await act(() => useChatPaneStore.getState().focus("first"));
  await expect.element(stash()).not.toBeInTheDocument();
  await act(() => (document.activeElement as HTMLElement).blur());
  await press(isMacPlatform(navigator.platform) ? "{Meta>}s{/Meta}" : "{Control>}s{/Control}");
  await expect.element(stash()).toBeInTheDocument();
  await press("{Escape}");
  await expect.element(stash()).not.toBeInTheDocument();
});
