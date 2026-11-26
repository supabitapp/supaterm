import { AsyncResult } from "effect/reactivity";
import * as Dialog from "../../components/ui/Dialog";
import { useAtomRefresh } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import type {
  PullRequestAction,
  PullRequestDetail,
  PullRequestUpdateMethod,
} from "@supaterm/contracts";
import { useRef, useState } from "react";
import { composerPullRequests } from "../../state/pull-requests";
import { useAtomCommand } from "../../state/use-atom-command";
import { canPerformPullRequestAction, pullRequestActionLabel } from "./pullRequestActions";
import { changeRequestTermKind } from "../../lib/changeRequestTerm";
import { pullRequestTarget, type PullRequestParams } from "./usePullRequestDiff";
import { usePullRequestPermissions } from "./usePullRequestPermissions";
import { playOutcomeHaptic } from "../../lib/outcomeHaptic";
import { useGT } from "gt-react-native";
export function usePullRequestAction(params: PullRequestParams, pr: PullRequestDetail | null) {
  const gt = useGT();
  const target = pullRequestTarget(params);
  const permissions = usePullRequestPermissions(params, pr);
  const run = useAtomCommand(composerPullRequests.runAction, {
    reportFailure: false,
  });
  const refreshActivity = useAtomRefresh(composerPullRequests.activity(target));
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const available = (action: PullRequestAction) =>
    pr !== null && !busy && permissions.canWrite && canPerformPullRequestAction(pr, action);
  const perform = async (action: PullRequestAction, updateMethod?: PullRequestUpdateMethod) => {
    if (pending.current || !available(action)) return;
    pending.current = true;
    setBusy(true);
    const response = await run({
      ...target,
      input: {
        ...target.input,
        action,
        ...(updateMethod
          ? {
              updateMethod,
            }
          : {}),
      },
    });
    pending.current = false;
    setBusy(false);
    playOutcomeHaptic(AsyncResult.isSuccess(response));
    if (AsyncResult.isFailure(response)) {
      const cause = squashAtomCommandFailure(response);
      Dialog.alert(
        gt(
          "Couldn't update this {term, select, mr {merge request} cr {change request} other {pull request}}",
          {
            term: changeRequestTermKind(sourceControlClients.get(pr?.provider).changeRequest),
          },
        ),
        cause instanceof Error ? cause.message : gt("Try again."),
      );
      return;
    }
    refreshActivity();
  };
  const confirm = (action: PullRequestAction, title: string, message: string) =>
    Dialog.alert(title, message, [
      {
        text: gt("Cancel"),
        style: "cancel",
      },
      {
        text: title,
        style: action === "close" || action === "delete-branch" ? "destructive" : "default",
        onPress: () => void perform(action),
      },
    ]);
  const confirmClose = () => {
    const terminology = sourceControlClients.get(pr?.provider).changeRequest;
    confirm(
      "close",
      pullRequestActionLabel("close", terminology),
      `Close this ${terminology.singular} without merging its changes?`,
    );
  };
  return {
    available,
    perform,
    confirm,
    confirmClose,
    busy,
  };
}
