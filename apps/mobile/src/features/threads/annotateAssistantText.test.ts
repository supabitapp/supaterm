import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  EnvironmentId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import { collectAssistantCitations } from "@supaterm/shared/assistantCitations";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import type { TextInputDialogRequest } from "../../components/ui/Dialog.types";

const dialog = vi.hoisted(() => ({
  prompts: [] as TextInputDialogRequest[],
  alerts: [] as { title: string; buttons: ReadonlyArray<{ onPress?: () => void }> }[],
}));

vi.mock("../../components/ui/Dialog", () => ({
  prompt: (request: TextInputDialogRequest) => {
    dialog.prompts.push(request);
  },
  alert: (title: string, _message?: string, buttons?: ReadonlyArray<{ onPress?: () => void }>) => {
    dialog.alerts.push({ title, buttons: buttons ?? [] });
  },
}));
vi.mock("expo-haptics", () => ({ selectionAsync: () => Promise.resolve() }));
vi.mock("expo-file-system", () => ({
  Directory: class {
    create() {}
  },
  File: class {
    exists = false;
    create() {}
    write() {}
    moveSync() {}
  },
  Paths: { document: { uri: "file:///documents" } },
}));

import { scopedThreadKey } from "../../lib/scopedEntities";
import { appAtomRegistry } from "../../state/atom-registry";
import { beginQueuedRunEdit, queuedEditDraftKey } from "../../state/queued-run-edit";
import {
  getComposerDraftSnapshot,
  rememberComposerDraftSelection,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { annotateAssistantText } from "./annotateAssistantText";

async function setup(thread: string) {
  dialog.prompts.length = 0;
  dialog.alerts.length = 0;
  await waitForComposerDraftsLoaded();
  const source = {
    environmentId: EnvironmentId.make("env-annotate"),
    threadId: ThreadId.make(thread),
    messageId: MessageId.make("message"),
  };
  return {
    source,
    threadKey: scopedThreadKey(source.environmentId, source.threadId),
    comments: (draftKey: string) =>
      collectAssistantCitations(getComposerDraftSnapshot(draftKey).text).map(
        ({ citation }) => citation.comment,
      ),
  };
}

it("puts the quote in the thread's draft when the queued edit it was opened for has ended", async () => {
  const { source, threadKey, comments } = await setup("thread-edit-ended");
  const runId = RunId.make("run-1");
  const runs = Atom.make<ReadonlyArray<{ readonly id: RunId; readonly status: string }> | null>([
    { id: runId, status: "queued" },
  ]);
  beginQueuedRunEdit(
    threadKey,
    {
      runId,
      messageId: MessageId.make("queued"),
      originalText: "original",
      existingAttachments: [],
    },
    runs,
  );
  const editKey = queuedEditDraftKey(threadKey, runId);

  annotateAssistantText({ source, draftKey: editKey, selection: { text: "replay", start: 15 } });
  appAtomRegistry.set(runs, [{ id: runId, status: "running" }]);
  dialog.prompts[0]!.onConfirm("Explain it");

  expect(getComposerDraftSnapshot(editKey).text).toBe("");
  expect(comments(threadKey)).toEqual(["Explain it"]);
});

it("reopens the prompt with the typed comment when it is too long, then saves the shortened one", async () => {
  const { source, threadKey, comments } = await setup("thread-long-comment");
  const tooLong = "a".repeat(ASSISTANT_CITATION_MAX_COMMENT_LENGTH + 1);

  annotateAssistantText({ source, draftKey: threadKey, selection: { text: "replay", start: 15 } });
  dialog.prompts[0]!.onConfirm(tooLong);

  expect(getComposerDraftSnapshot(threadKey).text).toBe("");
  expect(dialog.alerts.map((alert) => alert.title)).toEqual(["Comment is too long"]);
  dialog.alerts[0]!.buttons[0]!.onPress?.();
  expect(dialog.prompts[1]!.initialValue).toBe(tooLong);
  dialog.prompts[1]!.onConfirm("Shorter");
  expect(comments(threadKey)).toEqual(["Shorter"]);
});

it("checks the draft the quote would produce against the send limit", async () => {
  const { source, threadKey, comments } = await setup("thread-over-limit");
  const filler = "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 1000);
  const selection = { text: "引".repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH), start: 0 };
  setComposerDraftText(threadKey, filler);

  annotateAssistantText({ source, draftKey: threadKey, selection });
  dialog.prompts[0]!.onConfirm("Why this part");

  expect(getComposerDraftSnapshot(threadKey).text).toBe(filler);
  expect(dialog.alerts.map((alert) => alert.title)).toEqual(["Message is too long"]);
  dialog.alerts[0]!.buttons[0]!.onPress?.();
  expect(dialog.prompts[1]!.initialValue).toBe("Why this part");

  // The quote replaces the composer's selection, so that text does not count.
  rememberComposerDraftSelection(threadKey, filler, { start: 0, end: filler.length });
  dialog.prompts[1]!.onConfirm("Why this part");
  expect(comments(threadKey)).toEqual(["Why this part"]);
  expect(getComposerDraftSnapshot(threadKey).text).not.toContain("xxxx");
});
