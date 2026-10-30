import { readThreadShell } from "../../state/entities";
import { GuestShareIndicator } from "./GuestShareControls";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
  type ThreadPinnedMessage,
} from "@supaterm/contracts";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  settlePromise,
} from "@supaterm/client-runtime/state/runtime";
import { ChevronDownIcon } from "@supaterm/icons";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { isTrailingDoubleClick } from "../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { usePaneInputOwner } from "~/chatPanes/paneScope";
import { useShortcutLabel } from "~/hooks/useShortcutLabel";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import { readLocalApi } from "~/localApi";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";
import { subscribeThreadRename } from "./threadRenameActionBus";
import { PinnedMessagesMenu } from "./PinnedMessages";
import { useClientSettings } from "../../hooks/useSettings";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  isServerThread: boolean;
  activeProject: EnvironmentProject | null;
  parentThreadLink: { threadId: ThreadId; title: string } | null;
  onOpenThread: (threadId: ThreadId) => void;
  rightPanelOpen: boolean;
  pinnedMessages: ReadonlyArray<ThreadPinnedMessage>;
  onJumpToPinnedMessage: (pin: ThreadPinnedMessage) => void;
  onUnpinMessage?: ((pin: ThreadPinnedMessage) => void) | undefined;
  onNewThreadInProject: () => void;
  onFind?: (() => void) | undefined;
  onOpenProjectSettings?: (() => void) | undefined;
}

function resolveRenameCommit(input: {
  readonly title: string;
  readonly originalTitle: string;
}): { action: "commit"; title: string } | { action: "reject-empty" } | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}

// How long a click on the thread title waits before opening the action menu, so
// a double-click-to-rename can cancel it first. Only the native desktop menu
// needs this: it swallows input while open, so the wait must cover the OS
// double-click interval.
const TITLE_MENU_OPEN_DELAY_MS = 500;
export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  activeThreadTitle,
  isServerThread,
  activeProject,
  parentThreadLink,
  onOpenThread,
  rightPanelOpen,
  pinnedMessages,
  onJumpToPinnedMessage,
  onUnpinMessage,
  onNewThreadInProject,
  onFind,
  onOpenProjectSettings,
}: ChatHeaderProps) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const activeProjectName = activeProject?.isScratch ? "No project" : activeProject?.title;
  const newThreadShortcut = useShortcutLabel("chat.newLocal");
  const interfaceFont = useClientSettings((settings) => settings.fontFamilySans);
  const breadcrumbContainerRef = useRef<HTMLDivElement>(null);
  const [collapseParentTitle, setCollapseParentTitle] = useState(false);
  const activeThreadRef = scopeThreadRef(activeThreadEnvironmentId, activeThreadId);
  const canOperateThread = useEnvironmentScope(
    activeThreadEnvironmentId,
    AuthOrchestrationOperateScope,
  );
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const [renaming, setRenaming] = useState<{
    threadId: ThreadId;
    environmentId: EnvironmentId;
    title: string;
  } | null>(null);
  if (
    renaming !== null &&
    (renaming.threadId !== activeThreadId ||
      renaming.environmentId !== activeThreadEnvironmentId ||
      !canOperateThread)
  ) {
    setRenaming(null);
  }
  const renamingTitle =
    canOperateThread &&
    renaming?.threadId === activeThreadId &&
    renaming.environmentId === activeThreadEnvironmentId
      ? renaming.title
      : null;
  const isRenamingTitle = renamingTitle !== null;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- measures breadcrumb DOM overflow and observes size and font changes while mounted
  useEffect(() => {
    const list = breadcrumbContainerRef.current?.querySelector("ol");
    if (!list || !parentThreadLink) return;
    const measure = () => {
      const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
      const width = Array.from(list.children).reduce(
        (total, item) => {
          const label = item.querySelector('[data-slot="workspace-breadcrumb-text"]');
          const ellipsis = item.querySelector("[data-parent-breadcrumb-ellipsis]");
          return (
            total +
            (item.firstElementChild?.getBoundingClientRect().width ?? 0) +
            (label && getComputedStyle(label).maxWidth === "none"
              ? label.scrollWidth - label.clientWidth
              : 0) -
            (ellipsis?.getBoundingClientRect().width ?? 0)
          );
        },
        gap * (list.children.length - 1),
      );
      setCollapseParentTitle(width > list.clientWidth);
    };
    measure();
    const frame = requestAnimationFrame(measure);
    document.fonts.addEventListener("loadingdone", measure);
    const stopObserving = observeResize(list, measure);
    return () => {
      cancelAnimationFrame(frame);
      document.fonts.removeEventListener("loadingdone", measure);
      stopObserving();
    };
  }, [
    parentThreadLink,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- label text, font, and rename swaps change the fit; the effect reads them through the DOM
    activeProjectName,
    activeThreadTitle,
    interfaceFont,
    isRenamingTitle,
  ]);
  const renameCommittedRef = useRef(false);
  const startRename = useStableCallback(() => {
    if (
      !isServerThread ||
      !readEnvironmentScope(activeThreadEnvironmentId, AuthOrchestrationOperateScope)
    )
      return;
    renameCommittedRef.current = false;
    setRenaming({
      environmentId: activeThreadEnvironmentId,
      threadId: activeThreadId,
      title: activeThreadTitle,
    });
  });
  const isPaneInputOwner = usePaneInputOwner();
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes this pane's header to external rename commands until the thread changes
  useEffect(
    () =>
      subscribeThreadRename((threadRef) => {
        if (
          threadRef.environmentId === activeThreadEnvironmentId &&
          threadRef.threadId === activeThreadId &&
          isPaneInputOwner()
        ) {
          startRename();
        }
      }),
    [activeThreadEnvironmentId, activeThreadId, isPaneInputOwner, startRename],
  );
  const commitRename = (title: string) => {
    setRenaming(null);
    if (!readEnvironmentScope(activeThreadEnvironmentId, AuthOrchestrationOperateScope)) return;
    const resolution = resolveRenameCommit({ title, originalTitle: activeThreadTitle });
    if (resolution.action === "reject-empty") {
      toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
      return;
    }
    if (resolution.action === "noop") return;
    void updateThreadMetadata({
      environmentId: activeThreadEnvironmentId,
      input: { threadId: activeThreadId, title: resolution.title },
    }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    });
  };
  const { threadActions, closeMenu } = useThreadActionMenu({
    threadRef: isServerThread ? activeThreadRef : null,
    onStartRename: startRename,
  });
  const openMenu = (position: { x: number; y: number }) => {
    if (!isServerThread) return;
    const thread = readThreadShell(activeThreadRef);
    const api = readLocalApi();
    if (!thread || !api) return;
    const actions = threadActions(thread);
    void settlePromise(() =>
      api.contextMenu.show(
        onFind
          ? [{ id: "find" as const, label: "Find in thread" }, ...actions.items]
          : actions.items,
        position,
      ),
    ).then((result) => {
      if (result._tag === "Failure" || result.value === null) return;
      if (result.value === "find") {
        onFind?.();
        return;
      }
      void actions.run(result.value);
    });
  };
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleMenuTimerRef = useRef<{
    readonly threadRef: typeof activeThreadRef;
    readonly timeoutId: number;
  } | null>(null);
  const cancelPendingTitleMenu = () => {
    if (titleMenuTimerRef.current === null) return;
    clearTimeout(titleMenuTimerRef.current.timeoutId);
    titleMenuTimerRef.current = null;
  };
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- cancels the native title menu timer when its owning thread leaves the header
  useEffect(
    () => () => {
      const pending = titleMenuTimerRef.current;
      if (pending?.threadRef !== activeThreadRef) return;
      clearTimeout(pending.timeoutId);
      titleMenuTimerRef.current = null;
    },
    [activeThreadRef],
  );
  const openTitleMenuNow = () => {
    cancelPendingTitleMenu();
    const rect = titleButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    openMenu({ x: rect.left, y: rect.bottom + 4 });
  };
  const openMenuFromTitle = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (isTrailingDoubleClick(event.detail)) return;
    const clickedChevron =
      (event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null;
    if (event.detail === 0 || clickedChevron || window.desktopBridge === undefined) {
      openTitleMenuNow();
      return;
    }
    cancelPendingTitleMenu();
    titleMenuTimerRef.current = {
      threadRef: activeThreadRef,
      timeoutId: window.setTimeout(() => {
        titleMenuTimerRef.current = null;
        openTitleMenuNow();
      }, TITLE_MENU_OPEN_DELAY_MS),
    };
  };
  const handleTitleDoubleClick = (event: ReactMouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null) return;
    cancelPendingTitleMenu();
    closeMenu();
    startRename();
  };
  const handleHeaderContextMenu = (event: ReactMouseEvent) => {
    if (renamingTitle !== null) return;
    if (!isServerThread && onOpenProjectSettings === undefined) return;
    cancelPendingTitleMenu();
    event.preventDefault();
    if (!isServerThread) {
      const api = readLocalApi();
      if (!api) return;
      void api.contextMenu
        .show([{ id: "project-settings", label: "Project settings", icon: "settings" }], {
          x: event.clientX,
          y: event.clientY,
        })
        .then((action) => {
          if (action === "project-settings") onOpenProjectSettings?.();
        });
      return;
    }
    openMenu({ x: event.clientX, y: event.clientY });
  };
  const handleRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      renameCommittedRef.current = true;
      commitRename(event.currentTarget.value);
    } else if (event.key === "Escape") {
      renameCommittedRef.current = true;
      setRenaming(null);
    }
  };
  return (
    <div
      ref={breadcrumbContainerRef}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 sm:gap-3",
        rightPanelOpen ? "pr-10" : "pr-24",
      )}
      onContextMenu={handleHeaderContextMenu}
    >
      <WorkspaceBreadcrumb
        ariaLabel="Thread breadcrumb"
        className="flex-1 overflow-clip [overflow-clip-margin:2px]"
      >
        {activeProject ? (
          <>
            <WorkspaceBreadcrumbItem className="shrink">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`New thread in ${activeProjectName}`}
                      onClick={onNewThreadInProject}
                      className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    />
                  }
                >
                  <ProjectFavicon project={activeProject} className="size-3.5" />
                  <WorkspaceBreadcrumbText className="max-w-40">
                    {activeProjectName}
                  </WorkspaceBreadcrumbText>
                </TooltipTrigger>
                <TooltipPopup side="top" shortcut={newThreadShortcut}>
                  New thread in {activeProjectName}
                </TooltipPopup>
              </Tooltip>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator>
              <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
            </WorkspaceBreadcrumbSeparator>
          </>
        ) : null}
        {parentThreadLink ? (
          <>
            <WorkspaceBreadcrumbItem>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Open parent thread: ${parentThreadLink.title}`}
                      onClick={() => onOpenThread(parentThreadLink.threadId)}
                      className="inline-flex min-w-0 max-w-full cursor-pointer items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    />
                  }
                >
                  <WorkspaceBreadcrumbText
                    aria-hidden
                    className={collapseParentTitle ? "w-0" : undefined}
                  >
                    {parentThreadLink.title}
                  </WorkspaceBreadcrumbText>
                  {collapseParentTitle ? (
                    <span aria-hidden data-parent-breadcrumb-ellipsis>
                      ...
                    </span>
                  ) : null}
                </TooltipTrigger>
                <TooltipPopup side="top">{parentThreadLink.title}</TooltipPopup>
              </Tooltip>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator>
              <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
            </WorkspaceBreadcrumbSeparator>
          </>
        ) : null}
        <WorkspaceBreadcrumbItem current className="min-w-10 flex-1">
          {renamingTitle !== null ? (
            <input
              autoFocus
              dir="auto"
              aria-label="Thread title"
              className="min-w-0 flex-1 rounded-sm bg-transparent text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-ring/50 focus:ring-ring"
              defaultValue={renamingTitle}
              onBlur={(event) => {
                if (renameCommittedRef.current) return;
                if (
                  event.relatedTarget instanceof HTMLElement &&
                  event.relatedTarget.closest("button")
                ) {
                  setRenaming(null);
                  return;
                }
                commitRename(event.currentTarget.value);
              }}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={handleRenameKeyDown}
            />
          ) : isServerThread ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    ref={titleButtonRef}
                    type="button"
                    aria-label={`Thread actions for ${activeThreadTitle}`}
                    aria-haspopup="menu"
                    onClick={openMenuFromTitle}
                    onDoubleClick={canOperateThread ? handleTitleDoubleClick : undefined}
                    onBlur={cancelPendingTitleMenu}
                    className="group/thread-title inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  />
                }
              >
                <h2 className="min-w-0" dir={textDirection(activeThreadTitle)}>
                  <WorkspaceBreadcrumbText>{activeThreadTitle}</WorkspaceBreadcrumbText>
                </h2>
                <ChevronDownIcon
                  aria-hidden
                  data-thread-title-chevron
                  className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thread-title:opacity-100 group-focus-visible/thread-title:opacity-100"
                />
              </TooltipTrigger>
              <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <h2
                    aria-label={activeThreadTitle}
                    className="min-w-0 flex-1"
                    dir={textDirection(activeThreadTitle)}
                  />
                }
              >
                <WorkspaceBreadcrumbText>{activeThreadTitle}</WorkspaceBreadcrumbText>
              </TooltipTrigger>
              <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
            </Tooltip>
          )}
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      {isServerThread ? <GuestShareIndicator threadRef={activeThreadRef} /> : null}
      <PinnedMessagesMenu
        pins={pinnedMessages}
        timestampFormat={timestampFormat}
        onJump={onJumpToPinnedMessage}
        onUnpin={onUnpinMessage}
      />
    </div>
  );
});
