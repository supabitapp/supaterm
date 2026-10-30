import * as Dialog from "../../components/ui/Dialog";
import { useNavigation } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId } from "@supaterm/contracts";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { useRef, useState } from "react";

import { authClientMetadata } from "../../lib/authClientMetadata";
import { uuidv4 } from "../../lib/uuid";
import { projectEnvironment } from "../../state/projects";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  createNewTaskDraft,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";

const CLI_COMMAND = "npx supaterm triage";

export function useStartTriage() {
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const selectThreadRoute = (params: ReactNavigation.RootParamList["Thread"]) =>
    selectDetail({ name: "Thread", params });
  const prepare = useAtomCommand(serverEnvironment.prepareTriage, { reportFailure: false });
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const inFlight = useRef(false);
  const [isPending, setIsPending] = useState(false);

  const openTriageDraft = async (environmentId: EnvironmentId) => {
    const scratch = await openScratch({ environmentId, input: {} });
    if (scratch._tag === "Failure") return scratch;
    const prepared = await prepare({
      environmentId,
      input: { client: authClientMetadata(Constants.expoConfig?.version) },
    });
    if (prepared._tag === "Failure") return prepared;
    const opened = await settlePromise(async () => {
      await waitForComposerDraftsLoaded();

      if (!navigation.isFocused()) return;
      const draftId = createNewTaskDraft({ environmentId, projectId: scratch.value.id });
      setComposerDraftText(draftId, prepared.value.prompt);
      selectThreadRoute({
        draft: {
          requestId: uuidv4(),
          draftId,
          environmentId: String(environmentId),
          projectId: String(scratch.value.id),
          title: "Triage",
        },
      });
    });
    return opened._tag === "Failure" ? opened : null;
  };

  async function startTriage(environmentId: EnvironmentId) {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsPending(true);
    const failure = await openTriageDraft(environmentId);
    inFlight.current = false;
    setIsPending(false);
    if (failure !== null && !isAtomCommandInterrupted(failure)) {
      const error = squashAtomCommandFailure(failure);
      Dialog.alert(
        "Could not start triage",
        `${error instanceof Error ? error.message : "An error occurred."} Run ${CLI_COMMAND} in a terminal on that machine instead.`,
        [
          {
            text: "Copy command",
            onPress: () =>
              void Clipboard.setStringAsync(CLI_COMMAND).catch(() =>
                Dialog.alert("Could not copy", `Type ${CLI_COMMAND} instead.`),
              ),
          },
          { text: "OK", style: "cancel" },
        ],
      );
    }
  }

  return { startTriage, isPending };
}
