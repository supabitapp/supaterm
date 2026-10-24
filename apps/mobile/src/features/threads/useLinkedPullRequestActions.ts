import {
  pullRequestLinkProject,
  resolveLinkPullRequestInput,
} from "@supaterm/client-runtime/pull-request-link-input";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type ThreadPullRequestKey,
  type ThreadPullRequestLink,
} from "@supaterm/contracts";
import { normalizeThreadPullRequestKey } from "@supaterm/client-runtime/thread-pull-requests";
import * as Clipboard from "expo-clipboard";
import { useCallback, useMemo } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import type { MenuProps } from "../../components/ui/Menu.types";
import type { EnvironmentRuntimeState } from "../../state/remote-runtime-types";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

type MenuAction = MenuProps["actions"][number];

export function useLinkedPullRequestActions(input: {
  readonly thread: EnvironmentThreadShell | null;
  readonly project: EnvironmentProject | null;
  readonly runtime: EnvironmentRuntimeState | null;
}) {
  const { thread, project, runtime } = input;
  const canOperate = useEnvironmentScope(
    thread?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const canEdit = canOperate && runtime?.serverConfig != null;
  const canStartWatch =
    canEdit &&
    thread !== null &&
    thread.archivedAt === null &&
    thread.doneAt === null &&
    thread.doneOverride !== "done" &&
    thread.lineage.relationshipToParent !== "subagent";
  const link = useAtomCommand(threadEnvironment.linkPullRequest, { reportFailure: false });
  const unlink = useAtomCommand(threadEnvironment.unlinkPullRequest, { reportFailure: false });
  const watch = useAtomCommand(threadEnvironment.watchPullRequest, { reportFailure: false });

  const run = useCallback(
    async (failureTitle: string, pending: Promise<AtomCommandResult<unknown, unknown>>) => {
      const result = await pending;
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
      const cause = squashAtomCommandFailure(result);
      Dialog.alert(failureTitle, cause instanceof Error ? cause.message : "Try again.");
    },
    [],
  );

  const setLinked = useCallback(
    (reference: ThreadPullRequestKey & { readonly url: string }, linked: boolean) => {
      if (thread === null) return;
      const { environmentId, id: threadId } = thread;
      const key = normalizeThreadPullRequestKey(reference);
      void run(
        linked ? "Couldn't link this pull request" : "Couldn't unlink this pull request",
        linked
          ? link({
              environmentId,
              input: { threadId, ...reference, ...key, source: "manual" },
            })
          : unlink({ environmentId, input: { threadId, ...key } }),
      );
    },
    [link, run, thread, unlink],
  );

  const promptLink = useCallback(() => {
    Dialog.prompt({
      title: "Link pull request",
      message: "Paste a pull request URL, or enter 123 / #123 for this thread's repository.",
      placeholder: "Pull request URL or #42",
      initialValue: "",
      confirmText: "Link",
      onConfirm: (reference) => {
        const resolved = resolveLinkPullRequestInput({
          reference,
          project: pullRequestLinkProject(project?.repositoryIdentity),
          hasProject: () => true,
        });
        if (resolved === null) {
          Dialog.alert("Couldn't link this pull request", "Use a pull request URL, 123, or #123.");
          return;
        }
        if ("error" in resolved) {
          Dialog.alert("Couldn't link this pull request", resolved.error);
          return;
        }
        setLinked(resolved.link, true);
      },
    });
  }, [project, setLinked]);

  const menuActions = useCallback(
    (link: ThreadPullRequestLink): MenuAction[] => {
      const open = link.snapshot === null || link.snapshot.state === "open";
      const watching = link.watch !== undefined;
      return [
        { id: "copy", title: "Copy link", image: "link" },
        { id: "browser", title: "Open in browser", image: "safari" },
        ...((watching ? canEdit : canStartWatch) && open
          ? [
              {
                id: "watch",
                title: watching ? "Stop watching" : "Watch for changes",
                image: watching ? "eye.slash" : "eye",
              },
            ]
          : []),
        ...(canEdit
          ? [
              {
                id: "unlink",
                title: link.source === "stack" ? "Dismiss from thread" : "Unlink from thread",
                image: "xmark",
                attributes: { destructive: true },
              },
            ]
          : []),
      ];
    },
    [canEdit, canStartWatch],
  );

  const onMenuAction = useCallback(
    (link: ThreadPullRequestLink, action: string) => {
      if (action === "copy") void Clipboard.setStringAsync(link.url);
      else if (action === "browser")
        void tryOpenExternalUrl(link.url, "pull-request").then((opened) => {
          if (!opened) Dialog.alert("Unable to open PR", "The pull request could not be opened.");
        });
      else if (action === "watch" && thread !== null)
        void run(
          "Couldn't change watching",
          watch({
            environmentId: thread.environmentId,
            input: {
              threadId: thread.id,
              host: link.host,
              repository: link.repository,
              number: link.number,
              watching: link.watch === undefined,
            },
          }),
        );
      else if (action === "unlink") setLinked(link, false);
    },
    [run, setLinked, thread, watch],
  );

  return useMemo(
    () => ({ canLink: canEdit, promptLink, menuActions, onMenuAction }),
    [canEdit, promptLink, menuActions, onMenuAction],
  );
}

export type LinkedPullRequestActions = ReturnType<typeof useLinkedPullRequestActions>;
