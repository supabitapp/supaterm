import {
  CommandId,
  type EnvironmentId,
  type ModelSelection,
  type ScopedThreadRef,
  type ThreadId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import { findRevertCheckpoint } from "../../session-logic";
import { type ChatMessage } from "../../types";
import { randomUUID } from "~/lib/utils";
import {
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { prepareRevertedMessageAttachments, waitForRevertedMessage } from "../ChatView.logic";
import { readPreparedConnection } from "../../state/session";
import { recallableComposerPrompt } from "./composerPromptHistory";

// Kept per route so a send in flight, and the multiple-model selections, survive
// ChatView remounting while the user navigates.
export const draftFanoutSelectionsAtom = Atom.family((_routeKey: string) =>
  Atom.make<ReadonlyArray<ModelSelection> | null>(null).pipe(Atom.keepAlive),
);
const draftSendStateByRouteKey = new Map<string, { readonly sendInFlight: { current: boolean } }>();
export function draftSendState(routeKey: string) {
  let state = draftSendStateByRouteKey.get(routeKey);
  if (!state) {
    state = { sendInFlight: { current: false } };
    draftSendStateByRouteKey.set(routeKey, state);
  }
  return state;
}

/**
 * Reverts the thread to before `message` and puts that message's text and
 * attachments back in the composer draft. Returns the restored prompt, or the
 * error to show; on error the draft is untouched.
 */
export async function rewindToMessage(input: {
  readonly message: ChatMessage;
  readonly environmentId: EnvironmentId;
  readonly routeThreadRef: ScopedThreadRef;
  readonly threadId: ThreadId;
  readonly turnCount: number;
  readonly restoreFiles: boolean;
  readonly checkpoint: ReturnType<typeof findRevertCheckpoint>;
  readonly draftTarget: ScopedThreadRef | DraftId;
  readonly composerHasPendingAttachments: boolean;
  readonly createAssetUrl: Parameters<
    typeof prepareRevertedMessageAttachments
  >[0]["createAssetUrl"];
  readonly revertThreadCheckpoint: (value: {
    environmentId: EnvironmentId;
    input: {
      commandId: CommandId;
      threadId: ThreadId;
      turnCount: number;
      restoreFiles: boolean;
      checkpointId?: string;
      scopeId?: string;
    };
  }) => Promise<AtomCommandResult<unknown, unknown>>;
}): Promise<
  | { readonly error: string; readonly prompt?: never }
  | { readonly error: null; readonly prompt: string }
> {
  const { message, environmentId, draftTarget } = input;
  try {
    if (input.composerHasPendingAttachments) {
      throw new Error("Wait for attachments to finish preparing before rewinding.");
    }
    const connection = readPreparedConnection(environmentId);
    if (!connection) throw new Error("The environment is not connected.");
    const files = await prepareRevertedMessageAttachments({
      message,
      environmentId,
      httpBaseUrl: connection.httpBaseUrl,
      createAssetUrl: input.createAssetUrl,
    });
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(draftTarget);
    if (
      (draft?.images.length ?? 0) + (draft?.files.length ?? 0) + files.length >
      PROVIDER_SEND_TURN_MAX_ATTACHMENTS
    ) {
      throw new Error("Make room for this message's attachments in the composer before rewinding.");
    }
    const commandId = CommandId.make(randomUUID());
    await waitForRevertedMessage(input.routeThreadRef, input.turnCount, commandId, async () => {
      const result = await input.revertThreadCheckpoint({
        environmentId,
        input: {
          commandId,
          threadId: input.threadId,
          turnCount: input.turnCount,
          restoreFiles: input.restoreFiles,
          ...(input.checkpoint === undefined
            ? {}
            : { checkpointId: input.checkpoint.id, scopeId: input.checkpoint.scopeId }),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });
    const currentPrompt = store.getComposerDraft(draftTarget)?.prompt ?? "";
    const restoredPrompt = recallableComposerPrompt(message.text);
    const nextPrompt =
      restoredPrompt.length === 0
        ? currentPrompt
        : currentPrompt.length > 0
          ? `${currentPrompt}\n\n${restoredPrompt}`
          : restoredPrompt;
    store.setPrompt(draftTarget, nextPrompt);
    const images: ComposerImageAttachment[] = [];
    const restoredFiles: ComposerFileAttachment[] = [];
    files.forEach((file, index) => {
      const attachment = {
        id: randomUUID(),
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        file,
      };
      if (message.attachments?.[index]?.type === "image") {
        images.push({ ...attachment, type: "image", previewUrl: URL.createObjectURL(file) });
      } else {
        restoredFiles.push({ ...attachment, type: "file" });
      }
    });
    store.addImages(draftTarget, images, { allowDuplicates: true });
    store.addFiles(draftTarget, restoredFiles, { allowDuplicates: true });
    return { error: null, prompt: nextPrompt };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to revert thread state." };
  }
}
