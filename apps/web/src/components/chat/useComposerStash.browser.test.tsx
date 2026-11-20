import { EnvironmentId } from "@supaterm/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS, isMacPlatform } from "@supaterm/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { usePromptStashStore, writePromptStashStorageForTest } from "../../promptStashStore";
import {
  addPreparingComposerImages,
  countPreparingComposerImages,
  removePreparingComposerImages,
} from "./preparingComposerImages";
import { useComposerStash } from "./useComposerStash";

type StashInput = Parameters<typeof useComposerStash>[0];

function Harness({ input }: { input: StashInput }) {
  useComposerStash(input);
  return null;
}

it("keeps the draft when stashing while a pasted image is still compressing", async () => {
  const target = DraftId.make("stash-preparing-image");
  using _draft = {
    [Symbol.dispose]: () => useComposerDraftStore.getState().clearComposerContent(target),
  };
  using _stash = {
    [Symbol.dispose]: () => writePromptStashStorageForTest(""),
  };
  addPreparingComposerImages(target, [
    {
      id: "pasted",
      name: "shot.png",
      file: new File(["png"], "shot.png", { type: "image/png" }),
      hidden: false,
    },
  ]);
  using _preparing = {
    [Symbol.dispose]: () => removePreparingComposerImages(target, new Set(["pasted"])),
  };
  const environmentId = EnvironmentId.make("stash-env");
  const promptRef = { current: "Describe this screenshot" };
  const input = {
    environmentId,
    composerDraftTarget: target,
    attachmentDraftTarget: target,
    composerDraft: {
      prompt: promptRef.current,
      images: [],
      files: [],
      nonPersistedImageIds: [],
      persistedAttachments: [],
      terminalContexts: [],
      previewAnnotations: [],
      reviewComments: [],
      referenceContexts: [],
      replyTo: null,
      modelSelectionByProvider: {},
      activeProvider: null,
      runtimeMode: null,
      interactionMode: null,
    },
    promptRef,
    composerImagesRef: { current: [] },
    composerFilesRef: { current: [] },
    composerTerminalContextsRef: { current: [] },
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    terminalOpen: false,
    isPaneInputOwner: () => true,
    routeKind: "draft",
    projectSelectionRequired: false,
    isRevertingCheckpoint: false,
    isEditingQueuedMessage: false,
    pendingUserInputs: [],
    activePendingProgress: null,
    canQueueMessage: false,
    canQueueSelectedProvider: false,
    isSendBusy: false,
    sendDisabledReason: null,
    prompt: promptRef.current,
    composerMenuOpen: false,
    isComposerModelPickerOpen: false,
    isComposerCollapsedMobile: false,
    composerPreviewAnnotations: [],
    composerReviewComments: [],
    composerReferenceContexts: [],
    attachmentTargetKeyRef: { current: target },
    composerDraftTargetKeyRef: { current: target },
    composerEditorRef: { current: null },
    isRevertingCheckpointRef: { current: false },
    pendingThreadImportsRef: { current: new Map() },
    setComposerCursor: vi.fn(),
    setComposerTrigger: vi.fn(),
    importContextRecords: () => new Map(),
    expandMobileComposer: vi.fn(),
    submitComposer: () => null,
  } satisfies StashInput;
  await using _screen = await render(<Harness input={input} />);

  const mod = isMacPlatform(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
  await act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ...mod, bubbles: true, cancelable: true }),
    );
  });

  expect(usePromptStashStore.getState().entries).toEqual([]);
  expect(promptRef.current).toBe("Describe this screenshot");
  expect(countPreparingComposerImages(target)).toBe(1);
});
