import * as Dialog from "../../components/ui/Dialog";
import { StackActions, useNavigation } from "@react-navigation/native";
import { buildFeedbackPrompt } from "@supaterm/client-runtime/feedback-prompt";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId, ServerConfig } from "@supaterm/contracts";
import Constants from "expo-constants";
import { useRef, useState } from "react";
import { Platform } from "react-native";

import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  createNewTaskDraft,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";

export function useSendFeedback() {
  const navigation = useNavigation();
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const inFlight = useRef(false);
  const [isPending, setIsPending] = useState(false);

  async function sendFeedback(target: {
    readonly environmentId: EnvironmentId;
    readonly serverConfig: Pick<ServerConfig, "environment">;
  }) {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsPending(true);
    const opened = await openScratch({ environmentId: target.environmentId, input: {} });
    const result =
      opened._tag === "Failure"
        ? opened
        : await settlePromise(async () => {
            const project = opened.value;
            await waitForComposerDraftsLoaded();
            if (!navigation.isFocused()) return;
            const draftKey = createNewTaskDraft({
              environmentId: project.environmentId,
              projectId: project.id,
            });
            setComposerDraftText(
              draftKey,
              buildFeedbackPrompt({
                serverVersion: target.serverConfig.environment.serverVersion,
                client: `${Platform.OS === "ios" ? "iOS" : "Android"} app ${Constants.expoConfig?.version ?? "0.0.0"}`,
              }),
            );
            navigation.dispatch(
              StackActions.replace("NewTaskSheet", {
                screen: "NewTaskDraft",
                params: {
                  draftId: draftKey,
                  environmentId: String(project.environmentId),
                  projectId: String(project.id),
                  title: project.title,
                },
              }),
            );
          });
    inFlight.current = false;
    setIsPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        "Could not start feedback",
        error instanceof Error ? error.message : "Try again.",
      );
    }
  }

  return { sendFeedback, isPending };
}
