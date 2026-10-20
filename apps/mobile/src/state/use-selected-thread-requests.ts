import * as Dialog from "../components/ui/Dialog";
import { useServerConfigs } from "./entities";
import { CommandId } from "@supaterm/contracts";
import { uuidv4 } from "../lib/uuid";
import {
  questionAttachmentDraftKey,
  questionAttachmentDraftPrefix,
  questionAttachmentPreparationAtom,
} from "./question-attachments";
import {
  clearComposerDraft,
  composerDraftsAtom,
  questionAttachmentDraftsAtom,
} from "./use-composer-drafts";
import {
  composerAttachmentUploadsAtom,
  composerAttachmentUploadBlockReason,
  composerAttachmentsStillUploading,
} from "./composer-attachment-uploads";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUserInputAutoDismissPause } from "@supaterm/client-runtime/user-input-auto-dismiss-pause";

import { type ProviderApprovalDecision, type RuntimeRequestId } from "@supaterm/contracts";
import {
  type PendingThreadRequests,
  type ThreadUserInputQuestion,
  seedUserInputDraftAnswers,
} from "@supaterm/client-runtime/state/thread-requests";
import { AuthOrchestrationOperateScope } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { threadEnvironment } from "../state/threads";
import { scopedRequestKey } from "../lib/scopedEntities";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../lib/threadActivity";
import { appAtomRegistry } from "./atom-registry";
import { useSelectedThreadPendingRequests } from "./use-thread-detail";
import { useThreadSelection } from "./use-thread-selection";
import { useAtomCommand } from "./use-atom-command";
import { readEnvironmentScope } from "./session";

const EMPTY_PENDING_REQUESTS: PendingThreadRequests = { approvals: [], userInputs: [] };

const userInputDraftsByRequestKeyAtom = Atom.make<
  Record<string, Record<string, PendingUserInputDraftAnswer>>
>({}).pipe(Atom.keepAlive, Atom.withLabel("mobile:user-input-drafts"));

function setUserInputDraftOption(
  requestKey: string,
  question: ThreadUserInputQuestion,
  value: string,
): void {
  const current = appAtomRegistry.get(userInputDraftsByRequestKeyAtom);
  appAtomRegistry.set(userInputDraftsByRequestKeyAtom, {
    ...current,
    [requestKey]: {
      ...current[requestKey],
      [question.id]: togglePendingUserInputOptionSelection(
        question,
        current[requestKey]?.[question.id],
        value,
      ),
    },
  });
}

function setUserInputDraftCustomAnswer(
  requestKey: string,
  question: ThreadUserInputQuestion,
  customAnswer: string,
): void {
  const current = appAtomRegistry.get(userInputDraftsByRequestKeyAtom);
  appAtomRegistry.set(userInputDraftsByRequestKeyAtom, {
    ...current,
    [requestKey]: {
      ...current[requestKey],
      [question.id]: setPendingUserInputCustomAnswer(
        question,
        current[requestKey]?.[question.id],
        customAnswer,
      ),
    },
  });
}

export function useSelectedThreadRequests() {
  const respondToApproval = useAtomCommand(
    threadEnvironment.respondToApproval,
    "thread approval response",
  );
  const respondToUserInput = useAtomCommand(
    threadEnvironment.respondToUserInput,
    "thread user input response",
  );
  const dismissUserInput = useAtomCommand(
    threadEnvironment.dismissUserInput,
    "thread user input dismissal",
  );
  const pauseUserInputAutoDismiss = useAtomCommand(
    threadEnvironment.pauseUserInputAutoDismiss,
    "question timer pause",
  );
  const { selectedThread: selectedThreadShell } = useThreadSelection();
  const questionTimerPermission = useAtomValue(
    threadEnvironment.pauseUserInputAutoDismiss.permissionAtom(
      selectedThreadShell?.environmentId ?? null,
      { type: "thread.user-input.auto-dismiss.pause" },
    ),
  );
  const pendingRequests = useSelectedThreadPendingRequests();
  const userInputDraftsByRequestKey = useAtomValue(userInputDraftsByRequestKeyAtom);
  const userInputResponsesInFlight = useRef(new Set<string>());
  const [respondingApprovalId, setRespondingApprovalId] = useState<RuntimeRequestId | null>(null);
  const [respondingUserInputId, setRespondingUserInputId] = useState<RuntimeRequestId | null>(null);

  const activePendingApprovals = pendingRequests?.approvals ?? EMPTY_PENDING_REQUESTS.approvals;
  const activePendingApproval = activePendingApprovals[0] ?? null;
  const activePendingUserInputs = pendingRequests?.userInputs ?? EMPTY_PENDING_REQUESTS.userInputs;
  const activePendingUserInput = activePendingUserInputs[0] ?? null;
  useEffect(() => {
    if (!activePendingUserInput || !selectedThreadShell) return;
    const requestKey = scopedRequestKey(
      selectedThreadShell.environmentId,
      activePendingUserInput.requestId,
    );
    const existing = appAtomRegistry.get(userInputDraftsByRequestKeyAtom);
    const drafts = existing[requestKey] ?? {};
    const seeded = seedUserInputDraftAnswers(activePendingUserInput.questions, drafts);
    if (seeded !== drafts) {
      appAtomRegistry.set(userInputDraftsByRequestKeyAtom, { ...existing, [requestKey]: seeded });
    }
  }, [activePendingUserInput, selectedThreadShell]);
  const questionServerConfigs = useServerConfigs();
  const questionTimerConfig = selectedThreadShell
    ? questionServerConfigs.get(selectedThreadShell.environmentId)
    : undefined;
  const canPauseUserInputAutoDismiss =
    questionTimerPermission &&
    questionTimerConfig?.settings.autoDismissQuestions !== false &&
    questionTimerConfig != null;
  const attachmentDrafts = useAtomValue(
    questionAttachmentDraftsAtom(
      selectedThreadShell
        ? questionAttachmentDraftPrefix(selectedThreadShell.environmentId, selectedThreadShell.id)
        : "",
    ),
  );
  const preparationCounts = useAtomValue(questionAttachmentPreparationAtom);
  const uploadStates = useAtomValue(composerAttachmentUploadsAtom);
  useEffect(() => {
    if (!selectedThreadShell || !pendingRequests) return;
    const prefix = questionAttachmentDraftPrefix(
      selectedThreadShell.environmentId,
      selectedThreadShell.id,
    );
    const retained = new Set(
      activePendingUserInputs.flatMap((request) =>
        request.questions.map((question) =>
          questionAttachmentDraftKey(
            selectedThreadShell.environmentId,
            selectedThreadShell.id,
            request.requestId,
            question.id,
          ),
        ),
      ),
    );
    const counts = { ...appAtomRegistry.get(questionAttachmentPreparationAtom) };
    let changed = false;
    for (const key of new Set([...Object.keys(attachmentDrafts), ...Object.keys(counts)])) {
      if (!key.startsWith(prefix) || retained.has(key)) continue;
      if (attachmentDrafts[key]) clearComposerDraft(key);
      if (key in counts) {
        delete counts[key];
        changed = true;
      }
    }
    if (changed) appAtomRegistry.set(questionAttachmentPreparationAtom, counts);
  }, [activePendingUserInputs, attachmentDrafts, pendingRequests, selectedThreadShell]);
  const activePendingUserInputDrafts =
    activePendingUserInput && selectedThreadShell
      ? Object.fromEntries(
          activePendingUserInput.questions.map((question) => {
            const key = questionAttachmentDraftKey(
              selectedThreadShell.environmentId,
              selectedThreadShell.id,
              activePendingUserInput.requestId,
              question.id,
            );
            const attachments = attachmentDrafts[key]?.attachments ?? [];
            const attachmentsPreparing = (preparationCounts[key] ?? 0) > 0;
            const uploadInput = {
              environmentId: selectedThreadShell.environmentId,
              attachments,
              serverConfig: questionServerConfigs.get(selectedThreadShell.environmentId) ?? null,
              states: uploadStates,
            };
            return [
              question.id,
              {
                ...userInputDraftsByRequestKey[
                  scopedRequestKey(
                    selectedThreadShell.environmentId,
                    activePendingUserInput.requestId,
                  )
                ]?.[question.id],
                attachmentCount: attachments.length,
                attachmentsPreparing,
                attachmentsBlocked:
                  (attachments.length > 0 &&
                    !questionServerConfigs.has(selectedThreadShell.environmentId)) ||
                  attachmentsPreparing ||
                  composerAttachmentsStillUploading(uploadInput) ||
                  composerAttachmentUploadBlockReason({
                    ...uploadInput,
                    connected: true,
                  }) !== null,
              },
            ];
          }),
        )
      : {};
  const activePendingUserInputAnswers = activePendingUserInput
    ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingUserInputDrafts)
    : null;

  const pauseOnInteraction = useMemo(() => createUserInputAutoDismissPause(), []);
  const pauseQuestionTimer = useCallback(
    (requestId: RuntimeRequestId) => {
      const request = activePendingUserInputs.find((entry) => entry.requestId === requestId);
      if (!selectedThreadShell || !canPauseUserInputAutoDismiss || request?.autoDismissAt == null)
        return;
      void pauseOnInteraction(
        {
          environmentId: selectedThreadShell.environmentId,
          threadId: selectedThreadShell.id,
          requestId,
        },
        async () => {
          const result = await pauseUserInputAutoDismiss({
            environmentId: selectedThreadShell.environmentId,
            input: {
              type: "thread.user-input.auto-dismiss.pause",
              commandId: CommandId.make(uuidv4()),
              threadId: selectedThreadShell.id,
              requestId,
            },
          });
          return result._tag === "Success";
        },
      );
    },
    [
      activePendingUserInputs,
      canPauseUserInputAutoDismiss,
      pauseUserInputAutoDismiss,
      pauseOnInteraction,
      selectedThreadShell,
    ],
  );

  const onSelectUserInputOption = useCallback(
    (requestId: RuntimeRequestId, question: ThreadUserInputQuestion, value: string) => {
      pauseQuestionTimer(requestId);
      if (!selectedThreadShell) {
        return;
      }

      const requestKey = scopedRequestKey(selectedThreadShell.environmentId, requestId);
      setUserInputDraftOption(requestKey, question, value);
    },
    [selectedThreadShell, pauseQuestionTimer],
  );

  const onChangeUserInputCustomAnswer = useCallback(
    (requestId: RuntimeRequestId, questionId: string, customAnswer: string) => {
      const question = activePendingUserInputs
        .find((request) => request.requestId === requestId)
        ?.questions.find((entry) => entry.id === questionId);
      if (!selectedThreadShell || !question) {
        return;
      }

      const requestKey = scopedRequestKey(selectedThreadShell.environmentId, requestId);
      if (
        customAnswer !==
        (appAtomRegistry.get(userInputDraftsByRequestKeyAtom)[requestKey]?.[questionId]
          ?.customAnswer ?? "")
      )
        pauseQuestionTimer(requestId);
      setUserInputDraftCustomAnswer(requestKey, question, customAnswer);
    },
    [activePendingUserInputs, selectedThreadShell, pauseQuestionTimer],
  );

  const onRespondToApproval = useCallback(
    async (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => {
      if (
        !selectedThreadShell ||
        !readEnvironmentScope(selectedThreadShell.environmentId, AuthOrchestrationOperateScope)
      ) {
        return;
      }
      if (
        activePendingApprovals.find((approval) => approval.requestId === requestId)
          ?.responseCapability !== "live"
      ) {
        return;
      }

      setRespondingApprovalId(requestId);
      const result = await respondToApproval({
        environmentId: selectedThreadShell.environmentId,
        input: {
          threadId: selectedThreadShell.id,
          requestId,
          decision,
        },
      });
      setRespondingApprovalId((current) => (current === requestId ? null : current));
      return result;
    },
    [activePendingApprovals, respondToApproval, selectedThreadShell],
  );

  const onSubmitUserInput = useCallback(async () => {
    if (
      !selectedThreadShell ||
      !activePendingUserInput ||
      activePendingUserInput.responseCapability === "not_resumable" ||
      !activePendingUserInputAnswers ||
      !readEnvironmentScope(selectedThreadShell.environmentId, AuthOrchestrationOperateScope)
    ) {
      return;
    }

    const responseKey = questionAttachmentDraftKey(
      selectedThreadShell.environmentId,
      selectedThreadShell.id,
      activePendingUserInput.requestId,
      "",
    );
    if (userInputResponsesInFlight.current.has(responseKey)) return;
    const attachmentsByQuestionId = new Map<
      string,
      import("@supaterm/contracts").UserInputAttachments[string]
    >();
    for (const question of activePendingUserInput.questions) {
      const key = questionAttachmentDraftKey(
        selectedThreadShell.environmentId,
        selectedThreadShell.id,
        activePendingUserInput.requestId,
        question.id,
      );
      if ((appAtomRegistry.get(questionAttachmentPreparationAtom)[key] ?? 0) > 0) return;
      const attachments = appAtomRegistry.get(composerDraftsAtom)[key]?.attachments ?? [];
      if (attachments.length === 0) continue;
      if (
        attachments.some(
          (attachment) =>
            !attachment.uploadedAttachmentId ||
            attachment.uploadEnvironmentId !== selectedThreadShell.environmentId,
        )
      ) {
        Dialog.alert(
          "Attachments are not ready",
          "Wait for uploads to finish, or retry failed uploads.",
        );
        return;
      }
      attachmentsByQuestionId.set(
        question.id,
        attachments.map((attachment) => ({
          type: attachment.type,
          id: attachment.uploadedAttachmentId!,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        })),
      );
    }
    userInputResponsesInFlight.current.add(responseKey);
    setRespondingUserInputId(activePendingUserInput.requestId);
    const result = await respondToUserInput({
      environmentId: selectedThreadShell.environmentId,
      input: {
        threadId: selectedThreadShell.id,
        requestId: activePendingUserInput.requestId,
        answers: activePendingUserInputAnswers,
        ...(attachmentsByQuestionId.size > 0
          ? { attachmentsByQuestionId: Object.fromEntries(attachmentsByQuestionId) }
          : {}),
      },
    });
    userInputResponsesInFlight.current.delete(responseKey);
    setRespondingUserInputId((current) =>
      current === activePendingUserInput.requestId ? null : current,
    );
    return result;
  }, [
    activePendingUserInput,
    activePendingUserInputAnswers,
    respondToUserInput,
    selectedThreadShell,
  ]);

  const onDismissUserInput = useCallback(async () => {
    if (
      !selectedThreadShell ||
      !activePendingUserInput ||
      !readEnvironmentScope(selectedThreadShell.environmentId, AuthOrchestrationOperateScope)
    ) {
      return;
    }

    setRespondingUserInputId(activePendingUserInput.requestId);
    const result = await dismissUserInput({
      environmentId: selectedThreadShell.environmentId,
      input: {
        threadId: selectedThreadShell.id,
        requestId: activePendingUserInput.requestId,
      },
    });
    setRespondingUserInputId((current) =>
      current === activePendingUserInput.requestId ? null : current,
    );
    return result;
  }, [activePendingUserInput, dismissUserInput, selectedThreadShell]);

  return {
    activePendingApproval,
    activePendingUserInput,
    activePendingUserInputDrafts,
    activePendingUserInputAnswers,
    respondingApprovalId,
    respondingUserInputId,
    onRespondToApproval,
    onSelectUserInputOption,
    onChangeUserInputCustomAnswer,
    onSubmitUserInput,
    onDismissUserInput,
  };
}
