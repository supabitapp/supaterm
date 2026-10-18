import {
  ChatAttachment,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type EnvironmentId,
  type OrchestrationMessageContext,
} from "@supaterm/contracts";
import {
  ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  collectComposerContextReferences,
} from "@supaterm/shared/composerContextReferences";
import * as Schema from "effect/Schema";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  DraftId,
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
} from "../composerDraftStore";
import { removeInlineContextReference } from "../lib/composerContextReferences";
import { getUploadedAttachments, releaseDraftAttachments } from "../lib/attachmentUploadQueue";
import { replaceThreadOutboxTurn, webThreadOutbox, type PendingThreadTurn } from "./threadOutbox";
import type { OutboxTurn } from "./threadOutboxSchema";

const decodeAttachment = Schema.decodeUnknownSync(ChatAttachment);
function inputAttachmentId(entry: PendingThreadTurn, index: number) {
  return entry.payload.input.message.attachments[index]!.id ?? `outbox:${entry.id}:${index}`;
}

function threadOutboxEditAttachments(entry: PendingThreadTurn) {
  return [
    ...entry.payload.localAttachments.map((attachment) => ({
      attachment: decodeAttachment({ ...attachment, id: attachment.id }),
      bytes: attachment.bytes,
      url: null as string | null,
    })),
    ...entry.payload.input.message.attachments.map((attachment, index) => ({
      attachment: decodeAttachment({ ...attachment, id: inputAttachmentId(entry, index) }),
      bytes: null,
      url: "dataUrl" in attachment ? attachment.dataUrl : null,
    })),
  ];
}

/** The outbox owns its own bytes; an attachment without them must already be uploaded. */
export function captureOutboxAttachments(
  environmentId: EnvironmentId,
  attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>,
) {
  return attachments.map((attachment) => {
    const uploaded =
      attachment.file === null
        ? getUploadedAttachments({ environmentId, images: [attachment] })?.[0]
        : undefined;
    if (attachment.file === null && uploaded === undefined)
      throw new Error(`Attach '${attachment.name}' again before sending.`);
    return {
      id: attachment.id,
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      bytes: attachment.file,
      ...(attachment.source ? { source: attachment.source } : {}),
      ...(uploaded ? { uploaded } : {}),
    };
  });
}

/** Keep saved context and bytes while applying the composer's attachment edits. */
export function buildEditedThreadOutboxTurn(input: {
  readonly entry: PendingThreadTurn;
  readonly text: string;
  readonly keptAttachmentIds: ReadonlyArray<string>;
  readonly addedAttachments: OutboxTurn["localAttachments"];
  readonly context?: OrchestrationMessageContext | undefined;
}) {
  const { payload } = input.entry;
  const kept = new Set(input.keptAttachmentIds);
  const localAttachments = [
    ...payload.localAttachments.filter((attachment) => kept.has(attachment.id)),
    ...input.addedAttachments,
  ];
  const attachments = payload.input.message.attachments.filter((_attachment, index) =>
    kept.has(inputAttachmentId(input.entry, index)),
  );
  const count = localAttachments.length + attachments.length;
  if (count > PROVIDER_SEND_TURN_MAX_ATTACHMENTS)
    throw new Error(
      `A message can have at most ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments.`,
    );
  const attachmentIds = new Set([
    ...localAttachments.flatMap((attachment) => [attachment.id, attachment.uploaded?.id]),
    ...attachments.map((attachment) => attachment.id),
  ]);
  let text = input.text.trim();
  for (const record of payload.input.message.context?.records ?? []) {
    if ("attachmentId" in record && !attachmentIds.has(record.attachmentId))
      text = removeInlineContextReference(text, record.contextId).prompt;
  }
  if (!text && count === 0) throw new Error("Enter a message or keep an attachment.");
  const references = new Set(
    collectComposerContextReferences(text).map((reference) => reference.contextId),
  );
  const records = [
    ...new Map(
      [
        ...(payload.input.message.context?.records ?? []).filter((record) =>
          references.has(record.contextId),
        ),
        ...(input.context?.records ?? []),
      ].map((record) => [record.contextId, record] as const),
    ).values(),
  ];
  const { context: _, ...message } = payload.input.message;
  return {
    ...payload,
    localAttachments,
    input: {
      ...payload.input,
      message: {
        ...message,
        text: text || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
        attachments,
        ...(records.length > 0 ? { context: { version: 1 as const, records } } : {}),
      },
    },
  };
}

/** An isolated composer draft leaves the user's normal draft untouched. */
export function createThreadOutboxEditor(routeKey: string) {
  let editing: {
    readonly entry: PendingThreadTurn;
    readonly draftTarget: DraftId;
    readonly keptAttachmentIds: ReadonlyArray<string>;
  } | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  function finish(saved: boolean) {
    generation += 1;
    if (!editing) return;
    const { entry, draftTarget } = editing;
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(draftTarget);
    if (draft)
      releaseDraftAttachments(
        [...draft.images, ...draft.files].filter(
          (attachment) => !saved || attachment.file !== null,
        ),
      );
    store.clearDraftThread(draftTarget);
    editing = null;
    publish();
    void webThreadOutbox.pause(entry.id, false).catch(console.error);
  }
  const cancel = () => finish(false);
  return {
    getSnapshot: () => editing,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin: async (entry: PendingThreadTurn) => {
      const request = ++generation;
      if (!(await webThreadOutbox.pause(entry.id, true)))
        throw new Error("Delivery has already started.");
      if (generation !== request) {
        await webThreadOutbox.pause(entry.id, false);
        return;
      }
      cancel();
      const draftTarget = DraftId.make(`outbox-edit:${routeKey}:${entry.id}`);
      const store = useComposerDraftStore.getState();
      store.clearDraftThread(draftTarget);
      store.setPrompt(draftTarget, entry.payload.input.message.text);
      store.setModelSelection(draftTarget, entry.payload.input.modelSelection, {
        replaceOptions: true,
      });
      store.setRuntimeMode(draftTarget, entry.payload.input.runtimeMode);
      editing = {
        entry,
        draftTarget,
        keptAttachmentIds: threadOutboxEditAttachments(entry).map(
          ({ attachment }) => attachment.id,
        ),
      };
      publish();
    },
    removeAttachment: (id: string) => {
      if (!editing) return;
      editing = {
        ...editing,
        keptAttachmentIds: editing.keptAttachmentIds.filter((candidate) => candidate !== id),
      };
      const store = useComposerDraftStore.getState();
      let prompt = store.getComposerDraft(editing.draftTarget)?.prompt ?? "";
      const local = editing.entry.payload.localAttachments.find(
        (attachment) => attachment.id === id,
      );
      for (const record of editing.entry.payload.input.message.context?.records ?? []) {
        if (
          "attachmentId" in record &&
          (record.attachmentId === id || record.attachmentId === local?.uploaded?.id)
        )
          prompt = removeInlineContextReference(prompt, record.contextId).prompt;
      }
      store.setPrompt(editing.draftTarget, prompt);
      publish();
    },
    save: async (payload: OutboxTurn) => {
      const current = editing;
      if (!current) return null;
      const threadRef = await replaceThreadOutboxTurn(current.entry, payload);
      if (editing === current) finish(true);
      return threadRef;
    },
    cancel,
  };
}

export function useThreadOutboxEditor(routeKey: string) {
  // The editor holds the edit session, so it is replaced only when the route changes.
  const [current, setCurrent] = useState(() => ({
    routeKey,
    editor: createThreadOutboxEditor(routeKey),
  }));
  let editor = current.editor;
  if (current.routeKey !== routeKey) {
    editor = createThreadOutboxEditor(routeKey);
    setCurrent({ routeKey, editor });
  }
  const editing = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const entry = editing?.entry;
  const editingId = entry?.id;
  useEffect(() => () => editor.cancel(), [editor]);
  useEffect(() => {
    if (!editingId) return;
    const timer = setInterval(() => {
      void webThreadOutbox.pause(editingId, true).catch(console.error);
    }, 20_000);
    return () => clearInterval(timer);
  }, [editingId]);
  const previews = useThreadOutboxAttachments(entry);
  const attachments = editing
    ? previews.filter(({ attachment }) => editing.keptAttachmentIds.includes(attachment.id))
    : null;
  return { editor, editing, attachments };
}

function threadOutboxAttachmentPreviews(entry: PendingThreadTurn | undefined) {
  return entry
    ? threadOutboxEditAttachments(entry).map((item) => ({
        attachment: item.attachment,
        url:
          item.attachment.type === "image" && item.bytes
            ? URL.createObjectURL(item.bytes)
            : item.url,
      }))
    : [];
}

export function useThreadOutboxAttachments(entry: PendingThreadTurn | undefined) {
  // The effect revokes each preview set's object URLs, so a set is rebuilt only for a new entry.
  const [current, setCurrent] = useState(() => ({
    entry,
    previews: threadOutboxAttachmentPreviews(entry),
  }));
  let previews = current.previews;
  if (current.entry !== entry) {
    previews = threadOutboxAttachmentPreviews(entry);
    setCurrent({ entry, previews });
  }
  useEffect(
    () => () => {
      for (const item of previews) if (item.url?.startsWith("blob:")) URL.revokeObjectURL(item.url);
    },
    [previews],
  );
  return previews;
}
