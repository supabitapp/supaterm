import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  EnvironmentId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import {
  collectAssistantCitations,
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@supaterm/shared/assistantCitations";
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

import { promptAssistantAnnotation } from "../../components/assistantAnnotationPrompt";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { appAtomRegistry } from "../../state/atom-registry";
import { beginQueuedRunEdit, queuedEditDraftKey } from "../../state/queued-run-edit";
import { replaceDraftQuote } from "../../state/annotationDrafts";
import {
  flushComposerDrafts,
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

it("saves a chip's edited comment wherever its queued edit was recovered to, or says the quote is gone", async () => {
  const citation = (source: Awaited<ReturnType<typeof setup>>["source"]) => ({
    version: 1 as const,
    ...source,
    text: "replay",
    start: 15,
    end: 21,
    prefix: "",
    suffix: "",
  });
  const editWithChip = (threadKey: string, token: string) => {
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
    setComposerDraftText(editKey, `${token} `);
    return { editKey, start: () => appAtomRegistry.set(runs, [{ id: runId, status: "running" }]) };
  };

  // Recovery treats a whitespace-only thread draft as empty, yet merges behind it.
  const recovered = await setup("thread-edit-recovered");
  const kept = citation(recovered.source);
  const keptToken = serializeAssistantCitation(kept);
  setComposerDraftText(recovered.threadKey, " ");
  const keptEdit = editWithChip(recovered.threadKey, keptToken);
  keptEdit.start();
  await flushComposerDrafts();
  expect(
    replaceDraftQuote(
      keptEdit.editKey,
      { source: keptToken, start: 0, end: keptToken.length },
      withAssistantCitationComment(kept, "Explain it"),
    ),
  ).toBeNull();
  expect(getComposerDraftSnapshot(keptEdit.editKey).text).toBe("");
  expect(recovered.comments(recovered.threadKey)).toEqual(["Explain it"]);

  const discarded = await setup("thread-edit-discarded");
  const dropped = citation(discarded.source);
  const droppedToken = serializeAssistantCitation(dropped);
  setComposerDraftText(discarded.threadKey, "other work");
  const droppedEdit = editWithChip(discarded.threadKey, droppedToken);
  droppedEdit.start();
  promptAssistantAnnotation(dropped, "edit", (annotated) =>
    replaceDraftQuote(
      droppedEdit.editKey,
      { source: droppedToken, start: 0, end: droppedToken.length },
      annotated,
    ),
  );
  dialog.prompts[0]!.onConfirm("Explain it");
  expect(dialog.alerts.map((alert) => alert.title)).toEqual(["Quote is no longer in the draft"]);
  dialog.alerts[0]!.buttons[0]!.onPress?.();
  expect(dialog.prompts).toHaveLength(1);
  expect(getComposerDraftSnapshot(discarded.threadKey).text).toBe("other work");
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
