import * as Dialog from "../../components/ui/Dialog";
import { StackActions, useNavigation } from "@react-navigation/native";
import { resolveThreadReferenceCopyTarget } from "@supaterm/client-runtime/thread-reference";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { resolveThreadForkSource } from "@supaterm/client-runtime/state/thread-workflows";
import { AuthOrchestrationOperateScope, ThreadId } from "@supaterm/contracts";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactNode,
} from "react";

import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { suppressKeyboardMotion } from "../../lib/motionInput";
import { SupatermKeyboardCommands } from "../../native/SupatermKeyboardCommands";
import { useThreadShell } from "../../state/entities";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentScope } from "../../state/session";
import { uuidv4 } from "../../lib/uuid";
import { waitForThreadShellReady } from "../threads/threadForkNavigation";
import type { GitActionProgress } from "../../state/use-vcs-action-state";
import { GitActionProgressOverlay } from "../threads/GitActionProgressOverlay";
import { readStartNewTaskDestination } from "../threads/use-start-new-task";
import { CommandPalette } from "./CommandPalette";
import {
  dispatchHardwareKeyboardCommand,
  getHardwareKeyboardCommandRegistrationVersion,
  getRegisteredHardwareKeyboardCommands,
  parseActiveThreadPath,
  subscribeToHardwareKeyboardCommandRegistrations,
  type HardwareKeyboardCommand,
} from "./hardwareKeyboardCommands";

const EMPTY_COPY_FEEDBACK: GitActionProgress = {
  phase: "idle",
  label: null,
  description: null,
};
const COPY_FEEDBACK_DISMISS_MS = 3_000;

const CommandPaletteContext = createContext<ReactNode>(null);

let registeredCommandsSnapshot: {
  readonly version: number;
  readonly commands: ReadonlySet<HardwareKeyboardCommand>;
} | null = null;

function getRegisteredCommandsSnapshot(): ReadonlySet<HardwareKeyboardCommand> {
  const version = getHardwareKeyboardCommandRegistrationVersion();
  if (registeredCommandsSnapshot === null || registeredCommandsSnapshot.version !== version) {
    registeredCommandsSnapshot = { version, commands: getRegisteredHardwareKeyboardCommands() };
  }
  return registeredCommandsSnapshot.commands;
}

/** Render inside the workspace so palette actions share its navigation and pane state. */
export function HardwareKeyboardCommandOverlay() {
  return use(CommandPaletteContext);
}

export function HardwareKeyboardCommandProvider({
  children,
  pathname,
}: PropsWithChildren<{ readonly pathname: string }>) {
  const navigation = useNavigation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const activeThreadRef = useMemo(() => parseActiveThreadPath(pathname), [pathname]);
  const activeThread = useThreadShell(activeThreadRef);
  const forkFromRun = useAtomCommand(threadEnvironment.forkFromRun, "fork thread");
  const canFork = useEnvironmentScope(
    activeThreadRef?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const forkInFlight = useRef(false);
  const copyTarget = useMemo(
    () =>
      activeThreadRef === null
        ? null
        : resolveThreadReferenceCopyTarget({
            threadId: activeThread?.id ?? activeThreadRef.threadId,
            pullRequests: activeThread?.pullRequests,
            linkedPullRequestUrl:
              (activeThread?.linkedPullRequest ?? activeThread?.branchPullRequest)?.url ?? null,
          }),
    [activeThread, activeThreadRef],
  );
  const [copyFeedback, setCopyFeedback] = useState<GitActionProgress>(EMPTY_COPY_FEEDBACK);
  const copyRequestIdRef = useRef(0);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissCopyFeedback = useCallback(() => {
    if (copyFeedbackTimerRef.current !== null) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
    setCopyFeedback(EMPTY_COPY_FEEDBACK);
  }, []);
  const showCopyFeedback = useCallback((feedback: GitActionProgress) => {
    if (copyFeedbackTimerRef.current !== null) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
    setCopyFeedback(feedback);
    copyFeedbackTimerRef.current = setTimeout(() => {
      copyFeedbackTimerRef.current = null;
      setCopyFeedback(EMPTY_COPY_FEEDBACK);
    }, COPY_FEEDBACK_DISMISS_MS);
  }, []);
  useEffect(
    () => () => {
      if (copyFeedbackTimerRef.current !== null) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
    },
    [],
  );
  const registeredCommands = useSyncExternalStore(
    subscribeToHardwareKeyboardCommandRegistrations,
    getRegisteredCommandsSnapshot,
    getRegisteredCommandsSnapshot,
  );
  const enabledCommands = useMemo(() => {
    const commands = new Set<HardwareKeyboardCommand>(registeredCommands);
    commands.add("newTask");
    commands.add("commandPalette");
    if (pathname !== "/" && !pathname.startsWith("/threads/")) {
      for (const command of commands) {
        if (command.startsWith("thread.jump.")) commands.delete(command);
      }
    }
    if (pathname !== "/" || navigation.canGoBack()) commands.add("back");
    if (activeThreadRef !== null) {
      commands.add("files");
      commands.add("terminal");
      commands.add("review");
      if (pathname.split("/")[4] !== "terminal") commands.add("copyThreadReference");
      if (canFork && pathname.split("/")[4] !== "terminal") commands.add("forkThread");
    }
    return [...commands];
  }, [activeThreadRef, canFork, pathname, registeredCommands, navigation]);

  const onCommand = useCallback(
    (command: HardwareKeyboardCommand) => {
      suppressKeyboardMotion();
      if (command === "commandPalette") {
        setPaletteOpen(true);
        return;
      }
      if (dispatchHardwareKeyboardCommand(command)) return;

      if (command === "forkThread") {
        if (activeThreadRef === null || activeThread === null || !canFork || forkInFlight.current)
          return;
        const projection = appAtomRegistry.get(
          environmentThreadDetails.threadAtom(activeThreadRef),
        );
        const source = projection === null ? null : resolveThreadForkSource(projection.projection);
        if (source === null) return;
        const { environmentId } = activeThreadRef;
        const targetThreadId = ThreadId.make(uuidv4());
        const targetThreadRef = scopeThreadRef(environmentId, targetThreadId);
        forkInFlight.current = true;
        void forkFromRun({
          environmentId,
          input: {
            ...source,
            targetThreadId,
            title: `${activeThread.title} fork`,
            creationSource: "mobile",
          },
        })
          .then(async (result) => {
            if (result._tag !== "Success") return;
            const ready = await waitForThreadShellReady({
              read: () =>
                appAtomRegistry.get(environmentThreadShells.threadShellAtom(targetThreadRef)) !==
                null,
            });
            if (!ready) {
              Dialog.alert(
                "Fork created",
                "Its thread data did not reach this client. Reconnect and try opening it from the thread list.",
              );
              return;
            }
            navigation.navigate("Thread", { environmentId, threadId: targetThreadId });
          })
          .finally(() => {
            forkInFlight.current = false;
          });
        return;
      }

      if (command === "copyThreadReference") {
        if (copyTarget === null) return;
        const requestId = ++copyRequestIdRef.current;
        void tryCopyTextWithHaptic(copyTarget.value, {
          target: copyTarget.clipboardTarget,
        }).then((didCopy) => {
          if (requestId !== copyRequestIdRef.current) return;
          showCopyFeedback(
            didCopy
              ? {
                  phase: "success",
                  label: copyTarget.successTitle,
                  description: copyTarget.value,
                }
              : {
                  phase: "error",
                  label: copyTarget.failureTitle,
                  description: "Try again.",
                },
          );
        });
        return;
      }

      if (command === "newTask") {
        void readStartNewTaskDestination(uuidv4()).then((params) =>
          navigation.navigate("Thread", params),
        );
        return;
      }
      if (command === "back") {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.dispatch(StackActions.replace("Home"));
        }
        return;
      }

      const thread = parseActiveThreadPath(pathname);
      if (!thread) return;
      if (command === "files" && !/\/files(?:\/|$)/.test(pathname)) {
        navigation.navigate("ThreadFiles", thread);
      }
      if (command === "terminal" && !/\/terminal(?:\/|$)/.test(pathname)) {
        navigation.navigate("ThreadTerminal", thread);
      }
      if (command === "review" && !/\/review(?:\/|$)/.test(pathname)) {
        navigation.navigate("ThreadReview", thread);
      }
    },
    [
      activeThread,
      activeThreadRef,
      canFork,
      copyTarget,
      forkFromRun,
      navigation,
      pathname,
      showCopyFeedback,
    ],
  );

  const palette = useMemo(
    () =>
      paletteOpen ? (
        <CommandPalette pathname={pathname} onClose={closePalette} onCommand={onCommand} />
      ) : null,
    [closePalette, onCommand, paletteOpen, pathname],
  );

  return (
    <CommandPaletteContext value={palette}>
      <SupatermKeyboardCommands enabledCommands={enabledCommands} onCommand={onCommand}>
        {children}
      </SupatermKeyboardCommands>
      <GitActionProgressOverlay progress={copyFeedback} onDismiss={dismissCopyFeedback} />
    </CommandPaletteContext>
  );
}
