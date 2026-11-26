import type {
  DeviceServiceState,
  EnvironmentId,
  MessageId,
  OrchestrationV2ThreadProjection,
  ScopedThreadRef,
  ThreadId,
} from "@supaterm/contracts";
import { rewindFileRestore } from "@supaterm/client-runtime/state/thread-repositories";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useRightPanelStore } from "~/rightPanelStore";
import { DeviceSetup } from "../device/DeviceSetup";
import { PullRequestThreadDialog } from "../PullRequestThreadDialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { WizardPopup } from "../ui/wizard";
import { findRevertCheckpoint } from "../../session-logic";
import { filesystemEnvironment } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { registerThreadOverlay } from "./threadOverlayRetention";
import { T } from "gt-react";

/**
 * Open state for overlays the chat view hosts. It lives in atoms rather than
 * ChatView state so opening or closing one renders only its host, not the
 * whole chat chrome. Each entry carries the thread it was opened for; a host
 * shows only its own thread's entry, and a thread no route or pane shows drops it.
 */
type ThreadOverlayAtom<T> = Atom.Writable<{ readonly threadKey: string; readonly value: T } | null>;

function makeThreadOverlayAtom<T>(label: string): ThreadOverlayAtom<T> {
  const atom = Atom.make<{ readonly threadKey: string; readonly value: T } | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`chat:${label}`),
  );
  registerThreadOverlay((shownThreadKeys) => {
    const entry = appAtomRegistry.get(atom);
    if (entry !== null && !shownThreadKeys.has(entry.threadKey)) closeThreadOverlay(atom);
  });
  return atom;
}

function closeThreadOverlay<T>(atom: ThreadOverlayAtom<T>): void {
  appAtomRegistry.set(atom, null);
}

function useThreadOverlay<T>(atom: ThreadOverlayAtom<T>, threadKey: string | null): T | null {
  const entry = useAtomValue(atom);
  return threadKey !== null && entry?.threadKey === threadKey ? entry.value : null;
}

const pullRequestThreadDialogAtom = makeThreadOverlayAtom<{
  readonly initialReference: string | null;
  readonly key: number;
}>("pull-request-thread-dialog");

export function openPullRequestThreadDialog(threadKey: string, reference?: string): void {
  appAtomRegistry.set(pullRequestThreadDialogAtom, {
    threadKey,
    value: { initialReference: reference ?? null, key: Date.now() },
  });
}

export function PullRequestThreadDialogHost(props: {
  readonly threadKey: string | null;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string | null;
  readonly onPrepared: (input: {
    branch: string;
    worktreePath: string | null;
    pullRequestUrl: string;
  }) => Promise<void> | void;
}) {
  const state = useThreadOverlay(pullRequestThreadDialogAtom, props.threadKey);
  if (state === null) return null;
  return (
    <PullRequestThreadDialog
      key={state.key}
      open
      environmentId={props.environmentId}
      threadId={props.threadId}
      cwd={props.cwd}
      initialReference={state.initialReference}
      onOpenChange={(open) => {
        if (!open) closeThreadOverlay(pullRequestThreadDialogAtom);
      }}
      onPrepared={props.onPrepared}
    />
  );
}

const deviceSetupDialogAtom = makeThreadOverlayAtom<true>("device-setup-dialog");

export function openDeviceSetupDialog(threadKey: string): void {
  appAtomRegistry.set(deviceSetupDialogAtom, { threadKey, value: true });
}

export function DeviceSetupDialogHost(props: {
  readonly threadKey: string | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly state: DeviceServiceState;
}) {
  const open = useThreadOverlay(deviceSetupDialogAtom, props.threadKey) !== null;
  const { threadRef } = props;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeThreadOverlay(deviceSetupDialogAtom);
      }}
    >
      <WizardPopup>
        {threadRef ? (
          <DeviceSetup
            environmentId={threadRef.environmentId}
            state={props.state}
            onComplete={() => {
              useRightPanelStore.getState().open(threadRef, "device");
              closeThreadOverlay(deviceSetupDialogAtom);
            }}
          />
        ) : null}
      </WizardPopup>
    </Dialog>
  );
}

interface PendingRevert {
  readonly turnCount: number;
  readonly messageId: MessageId;
}

const revertConfirmAtom = makeThreadOverlayAtom<PendingRevert>("revert-confirm");

export function openRevertConfirm(threadKey: string, pending: PendingRevert): void {
  appAtomRegistry.set(revertConfirmAtom, { threadKey, value: pending });
}

export function RevertConfirmHost(props: {
  readonly threadKey: string;
  readonly environmentId: EnvironmentId;
  /** The thread's worktree, which may be a task folder. */
  readonly taskFolderPath: string | null;
  readonly projection: Pick<
    OrchestrationV2ThreadProjection,
    "checkpoints" | "checkpointScopes"
  > | null;
  readonly worktreePath: string | null;
  readonly onConfirm: (turnCount: number, messageId: MessageId, restoreFiles: boolean) => void;
}) {
  const pending = useThreadOverlay(revertConfirmAtom, props.threadKey);
  const checkpoint =
    pending === null ? undefined : findRevertCheckpoint(props.projection, pending.turnCount);
  // Only a missing snapshot depends on the task folder: its repositories may still restore.
  const taskFolderQuery = useEnvironmentQuery(
    checkpoint?.status === "missing" && props.taskFolderPath !== null
      ? filesystemEnvironment.taskFolder({
          environmentId: props.environmentId,
          input: { worktreePath: props.taskFolderPath },
        })
      : null,
  );
  const fileRestore =
    // The server refuses file restore outside an isolated worktree.
    props.projection === null || props.worktreePath === null
      ? null
      : rewindFileRestore({
          projection: props.projection,
          checkpoint,
          taskFolder: taskFolderQuery.data?.taskFolder,
        });
  const confirm = (restoreFiles: boolean) => {
    if (pending === null || (restoreFiles && fileRestore === null)) return;
    closeThreadOverlay(revertConfirmAtom);
    props.onConfirm(pending.turnCount, pending.messageId, restoreFiles);
  };
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) closeThreadOverlay(revertConfirmAtom);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <T>Edit from here?</T>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {fileRestore === "repositories" ? (
              <T>
                Rewind chat to before this message. Your prompt and attachments return to the
                composer. “Revert repositories too” also undoes your own edits in this thread’s
                repository worktrees. Files in the project folder itself stay as they are.
              </T>
            ) : (
              <T>
                Rewind chat to before this message. Your prompt and attachments return to the
                composer. “Revert files too” also undoes your own edits.
              </T>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            <T>Cancel</T>
          </AlertDialogClose>
          <Button
            variant="destructive-outline"
            disabled={fileRestore === null}
            onClick={() => confirm(true)}
          >
            {fileRestore === "repositories" ? (
              <T>Revert repositories too</T>
            ) : (
              <T>Revert files too</T>
            )}
          </Button>
          <Button onClick={() => confirm(false)}>
            <T>Revert and keep changes</T>
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
