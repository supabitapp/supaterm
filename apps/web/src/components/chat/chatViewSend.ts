import {
  CommandId,
  type EnvironmentId,
  type ModelSelection,
  type ScopedThreadRef,
  type ThreadId,
  type ProviderInteractionMode,
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
import {
  formatOutgoingPrompt,
  getAntigravitySendBlockReason,
  prepareRevertedMessageAttachments,
  waitForRevertedMessage,
} from "../ChatView.logic";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@supaterm/shared/composerContextReferences";
import { createModelSelection } from "@supaterm/shared/model";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { getComposerPromptInjectionState, getComposerProviderState } from "./composerProviderState";
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

export interface MultipleModelTarget {
  readonly selection: ModelSelection;
  readonly text: string;
  readonly interactionMode: ProviderInteractionMode;
}

/**
 * The thread each selected model starts for a multiple-model send, in
 * selection order, or why that model cannot take the message.
 */
export function resolveMultipleModelTargets(input: {
  readonly selections: ReadonlyArray<ModelSelection>;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly messageText: string;
  readonly interactionMode: ProviderInteractionMode;
}): Array<MultipleModelTarget | { readonly error: string }> {
  const { messageText } = input;
  return input.selections.map((selection) => {
    const provider = input.providerInstanceEntries.find(
      (entry) => entry.instanceId === selection.instanceId,
    );
    if (!provider?.enabled || !provider.isAvailable || provider.status !== "ready") {
      return { error: `Provider for ${selection.model} is unavailable.` };
    }
    const providerBlockReason = getAntigravitySendBlockReason(provider.snapshot, selection.model);
    if (providerBlockReason) return { error: providerBlockReason };
    const providerState = getComposerProviderState({
      provider: provider.driverKind,
      model: selection.model,
      models: provider.models,
      modelOptions: selection.options,
      promptInjectionState: getComposerPromptInjectionState(messageText),
    });
    return {
      selection: createModelSelection(
        selection.instanceId,
        selection.model,
        providerState.modelOptionsForDispatch,
      ),
      text: formatOutgoingPrompt({
        provider: provider.driverKind,
        model: selection.model,
        models: provider.models,
        effort: providerState.promptEffort,
        text: messageText || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
      }),
      interactionMode: input.interactionMode,
    };
  });
}
