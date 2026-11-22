import * as Dialog from "../components/ui/Dialog";
import { useRef } from "react";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS, type ServerConfig } from "@supaterm/contracts";
import { clampFileAttachmentUploadBytes } from "@supaterm/client-runtime/state/attachments";
import { nextPastedTextFileName } from "@supaterm/client-runtime/text-paste";
import type { ComposerTextPaste } from "../native/SupatermComposerEditor.types";
import {
  convertPastedImagesToAttachments,
  createPastedTextComposerAttachment,
  pickComposerFiles,
  pickComposerMedia,
  removePersistedComposerAttachmentFile,
  skippedDuplicateAttachmentsMessage,
  type DraftComposerAttachment,
} from "../lib/composerImages";
import {
  appendComposerDraftAttachments,
  type ComposerDraftAttachmentsAppend,
  captureComposerDraftInsertion,
  countComposerDraftAttachmentsAfterSelection,
  getComposerDraftSnapshot,
  type ComposerDraftInsertion,
} from "./use-composer-drafts";
import { startComposerDraftOperation } from "./composerDraftOperations";

export function useComposerAttachmentActions(props: {
  readonly draftKey: string | null;
  readonly serverConfig: ServerConfig | null | undefined;
  readonly locked?: boolean;
}) {
  const reservedNames = useRef(new Map<string, Set<string>>());
  const maxUploadBytes =
    props.serverConfig?.environment.capabilities.fileAttachments?.maxUploadBytes;
  const append = async (
    key: string,
    signal: AbortSignal,
    attachments: ReadonlyArray<DraftComposerAttachment>,
    insertion: ComposerDraftInsertion,
  ): Promise<ComposerDraftAttachmentsAppend> => {
    if (signal.aborted) {
      await Promise.all(
        attachments.flatMap((item) =>
          item.fileUri ? [removePersistedComposerAttachmentFile(item.fileUri)] : [],
        ),
      );
      return { rejected: 0, duplicates: [] };
    }
    return appendComposerDraftAttachments(key, attachments, { appendReference: true, insertion });
  };
  // A picker may finish after its draft was discarded or the composer moved off it.
  const withDraftOperation = async <T>(key: string, work: (signal: AbortSignal) => Promise<T>) => {
    const operation = startComposerDraftOperation(key);
    return work(operation.signal).finally(operation.finish);
  };
  const report = (
    title: string,
    error: string | null | undefined,
    { rejected, duplicates }: ComposerDraftAttachmentsAppend,
  ) => {
    const skipped = skippedDuplicateAttachmentsMessage(duplicates);
    const problems = [
      ...(error ? [error] : []),
      ...(rejected
        ? [`You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments per message.`]
        : []),
      ...(skipped ? [skipped] : []),
    ];
    if (problems.length) Dialog.alert(title, problems.join("\n\n"));
  };
  const onPickDraftMedia = async () => {
    const key = props.draftKey;
    if (!key || props.locked) return;
    const insertion = captureComposerDraftInsertion(key);
    await withDraftOperation(key, async (signal) => {
      const result = await pickComposerMedia({
        existingCount: countComposerDraftAttachmentsAfterSelection(key, insertion),
        maxVideoBytes: maxUploadBytes,
      });
      report(
        "Could not attach photo or video",
        result.error,
        await append(key, signal, result.attachments, insertion),
      );
    });
  };
  const onPickDraftFiles = async () => {
    const key = props.draftKey;
    if (!key || props.locked) return;
    if (maxUploadBytes === undefined) {
      Dialog.alert("Could not attach file", "This server does not support file attachments.");
      return;
    }
    const insertion = captureComposerDraftInsertion(key);
    await withDraftOperation(key, async (signal) => {
      const result = await pickComposerFiles({
        existingCount: countComposerDraftAttachmentsAfterSelection(key, insertion),
        maxBytes: maxUploadBytes,
      });
      report(
        "Could not attach file",
        result.error,
        await append(key, signal, result.files, insertion),
      );
    });
  };
  const onNativePasteImages = async (uris: ReadonlyArray<string>) => {
    const key = props.draftKey;
    if (!key || props.locked || !uris.length) return false;
    const insertion = captureComposerDraftInsertion(key);
    return withDraftOperation(key, async (signal) => {
      try {
        const result = await convertPastedImagesToAttachments({ uris });
        const appended = await append(key, signal, result.attachments, insertion);
        report("Could not paste images", result.error, appended);
        if (signal.aborted) return false;
        if (result.error) return false;
        if (appended.rejected > 0) return false;
        return result.attachments.length > 0;
      } catch (error) {
        Dialog.alert(
          "Could not paste images",
          error instanceof Error ? error.message : "Try again.",
        );
        return false;
      }
    });
  };
  const onNativePasteText = async (paste: ComposerTextPaste) => {
    const key = props.draftKey;
    if (!key || props.locked || maxUploadBytes === undefined) return;
    const names = reservedNames.current.get(key) ?? new Set<string>();
    reservedNames.current.set(key, names);
    for (const attachment of getComposerDraftSnapshot(key).attachments) names.add(attachment.name);
    const name = nextPastedTextFileName([...names]);
    names.add(name);
    await withDraftOperation(key, async (signal) => {
      try {
        const attachment = await createPastedTextComposerAttachment({
          text: paste.text,
          name,
          maxBytes: clampFileAttachmentUploadBytes(maxUploadBytes),
        });
        const appended = await append(key, signal, [attachment], {
          text: paste.value,
          ...paste.selection,
        });
        if (appended.rejected) await removePersistedComposerAttachmentFile(attachment.fileUri);
        report("Could not attach pasted text", null, appended);
      } catch (error) {
        Dialog.alert(
          "Could not attach pasted text",
          error instanceof Error ? error.message : "Try again.",
        );
      }
    });
  };
  return { onPickDraftMedia, onPickDraftFiles, onNativePasteImages, onNativePasteText };
}
