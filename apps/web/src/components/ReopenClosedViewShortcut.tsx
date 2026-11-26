import { useAtomValue } from "@effect/atom-react";
import {
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@supaterm/client-runtime/environment";
import { PANE_FOCUS_KEYBINDING_COMMANDS, type ScopedThreadRef } from "@supaterm/contracts";
import { linkOptions, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useClosedViewStore } from "../closedViewStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { environmentCatalog } from "../connection/catalog";
import { effectiveShortcutsForCommand } from "../keybindings";
import {
  planNextReopen,
  pullRequestsSearchForRestore,
  reopenClosedView,
} from "../reopenClosedView";
import {
  ISSUES_PANEL_REF,
  PULL_REQUESTS_PANEL_REF,
  selectActiveRightPanel,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { registerCommands } from "../shortcuts/dispatcher";
import { readProject, readThreadShell } from "../state/entities";
import { previewEnvironment } from "../state/preview";
import { primaryServerKeybindingsAtom } from "../state/server";
import { environmentShell } from "../state/shell";
import { useAtomCommand } from "../state/use-atom-command";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { toastManager } from "./ui/toast";
import { readIssueListPreferences } from "./issue/issueListPreferences";
import { newestClosedPaneAt, useChatPaneStore } from "../chatPanes/store";
import { isChatPaneWorkspaceMounted } from "../chatPanes/actions";
import { focusedPane } from "../chatPanes/layout";
import { workspaceSize } from "../chatPanes/paneDrop";
import { useGT } from "gt-react";

declare module "@tanstack/react-router" {
  interface HistoryState {
    reopenedViewId?: string;
  }
}

const PREVIEW_FORWARDED_COMMANDS = [
  "workspace.focusNext",
  "workspace.focusPrevious",
  "sidebar.toggle",
  "rightPanel.toggle",
  "rightPanel.toggleMaximized",
  "rightPanel.new",
  "rightPanel.close",
  "pane.focusNext",
  "pane.focusPrevious",
  ...PANE_FOCUS_KEYBINDING_COMMANDS,
  "preview.focusUrl",
  "preview.zoomIn",
  "preview.zoomOut",
  "preview.resetZoom",
  "preview.find",
] as const;

const isGlobalPullRequests = (ref: ScopedThreadRef) =>
  scopedThreadKey(ref) === scopedThreadKey(PULL_REQUESTS_PANEL_REF);
const isGlobalIssues = (ref: ScopedThreadRef) =>
  scopedThreadKey(ref) === scopedThreadKey(ISSUES_PANEL_REF);

export function ReopenClosedViewShortcut() {
  const gt = useGT();
  const navigate = useNavigate();
  const router = useRouter();
  const params = useParams({ strict: false });
  const target = resolveThreadRouteTarget(params);
  const draft = useComposerDraftStore((state) =>
    target?.kind === "draft" ? state.getDraftSession(target.draftId) : null,
  );
  const threadRef =
    target?.kind === "server"
      ? target.threadRef
      : draft
        ? (draft.promotedTo ?? scopeThreadRef(draft.environmentId, draft.threadId))
        : null;
  const terminalOpen = useTerminalUiStateStore(
    (state) =>
      selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef).terminalOpen,
  );
  const previewOpen = useRightPanelStore(
    (state) => selectActiveRightPanel(state.byThreadKey, threadRef) === "preview",
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const hasViewHistory = useClosedViewStore((state) => state.entries.length > 0);
  const hasPaneHistory = useChatPaneStore((state) => state.closed.length > 0);
  const hasHistory = hasViewHistory || hasPaneHistory;
  const openPreview = useAtomCommand(previewEnvironment.open);
  const pending = useRef(Promise.resolve());
  type ReopenNavigation = { location: typeof router.history.location };
  const reopenNavigation = useRef<ReopenNavigation | null>(null);

  const reopenNext = useEffectEvent(async (request: ReopenNavigation) => {
    // Chat panes and panel views share one history: the most recently closed comes back first.
    const paneClosedAt = newestClosedPaneAt();
    const viewClosedAt = useClosedViewStore.getState().entries[0]?.closedAt ?? 0;
    if (paneClosedAt !== null && paneClosedAt >= viewClosedAt) {
      const store = useChatPaneStore.getState();
      if (!store.reopenClosed(workspaceSize()) || isChatPaneWorkspaceMounted()) return;
      const layout = useChatPaneStore.getState().layout;
      const reopened = layout ? focusedPane(layout).target : null;
      if (reopened?.kind === "server") {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(reopened.threadRef),
        });
      } else if (reopened?.kind === "draft") {
        await navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(reopened.draftId),
        });
      }
      return;
    }
    const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
    const drafts = useComposerDraftStore.getState();
    const panelsByThread = useRightPanelStore.getState().byThreadKey;
    const { drop, restore } = planNextReopen(useClosedViewStore.getState().entries, (entry) => {
      const ref = entry.threadRef;
      const panel = selectThreadRightPanelState(panelsByThread, ref);
      if (isGlobalPullRequests(ref) || isGlobalIssues(ref)) {
        return {
          environmentKnown: true,
          catalogReady: true,
          ownerExists: true,
          shellLive: true,
          panel,
        };
      }
      return {
        environmentKnown: catalog.entries.has(ref.environmentId),
        catalogReady: catalog.isReady,
        ownerExists: readThreadShell(ref) !== null || drafts.getDraftThreadByRef(ref) !== null,
        shellLive:
          appAtomRegistry.get(environmentShell.stateValueAtom(ref.environmentId)).status === "live",
        panel,
      };
    });
    for (const entry of drop) useClosedViewStore.getState().remove(entry.id);
    if (!restore) return;

    const ref = restore.threadRef;
    const globalPullRequests = isGlobalPullRequests(ref);
    const globalIssues = isGlobalIssues(ref);
    const thread = globalPullRequests || globalIssues ? null : readThreadShell(ref);
    const owner = thread ?? drafts.getDraftThreadByRef(ref);
    const project = owner ? readProject(scopeProjectRef(ref.environmentId, owner.projectId)) : null;
    if (!(await reopenClosedView(restore, { openPreview, workspaceAvailable: project !== null }))) {
      useClosedViewStore.getState().defer(restore.id);
      return;
    }
    useClosedViewStore.getState().remove(restore.id);
    if (router.history.location !== request.location) return;

    let destination;
    if (globalPullRequests) {
      const selected = selectSelectedRightPanelSurface(
        useRightPanelStore.getState().byThreadKey,
        ref,
      );
      destination = linkOptions({
        to: "/pull-requests",
        search: (previous) => pullRequestsSearchForRestore(previous, selected),
      });
    } else if (globalIssues) {
      destination = linkOptions({ to: "/issues", search: readIssueListPreferences() });
    } else {
      const draftId = thread === null ? drafts.getDraftIdByRef(ref) : null;
      destination =
        draftId !== null
          ? linkOptions({ to: "/draft/$draftId", params: buildDraftThreadRouteParams(draftId) })
          : linkOptions({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
    }

    const { history } = router;
    if (router.buildLocation(destination).publicHref === history.location.href) {
      const { reopenedViewId } = history.location.state;
      await navigate({ ...destination, state: reopenedViewId ? { reopenedViewId } : {} });
      return;
    }

    // An allowing blocker can defer the commit. Only the reopen's first history hop extends the queue.
    const unsubscribe = history.subscribe(({ location, action }) => {
      if (location === request.location) return;
      unsubscribe();
      if (action.type === "PUSH" && location.state.reopenedViewId === restore.id) {
        request.location = location;
      }
    });
    try {
      await navigate({ ...destination, state: { reopenedViewId: restore.id } });
    } catch (error) {
      unsubscribe();
      throw error;
    }
    unsubscribe();
  });

  const enqueueReopen = useEffectEvent(() => {
    const location = router.history.location;
    const previous = reopenNavigation.current;
    const request = previous?.location === location ? previous : { location };
    reopenNavigation.current = request;
    pending.current = pending.current
      .then(() => reopenNext(request))
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: gt("Could not reopen view"),
          description: error instanceof Error ? error.message : String(error),
        });
      });
  });

  const readPanelsOpen = useEffectEvent(() => ({ terminalOpen, previewOpen }));
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- registers the reopen closed view command with the dispatcher for the component's lifetime
  useEffect(
    () =>
      registerCommands(
        {
          "view.reopenClosed": ({ repeat }) => {
            if (!repeat) enqueueReopen();
          },
        },
        {
          capture: true,
          when: () =>
            !isCommandPaletteOpen() &&
            (useClosedViewStore.getState().entries.length > 0 ||
              useChatPaneStore.getState().closed.length > 0),
          context: () => readPanelsOpen(),
        },
      ),
    [],
  );

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- registers forwarded shortcut chords with the desktop preview bridge and clears them on cleanup
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    const options = {
      context: {
        previewFocus: true,
        previewOpen: true,
        rightPanelOpen: true,
        terminalFocus: false,
        terminalOpen,
        editableFocus: false,
        modelPickerOpen: false,
        isDesktop: true,
        isWeb: false,
      },
    };

    const commands = [
      ...(hasHistory ? (["view.reopenClosed"] as const) : []),
      ...PREVIEW_FORWARDED_COMMANDS,
    ];
    void preview
      .setForwardedShortcuts(
        commands.flatMap((command) =>
          effectiveShortcutsForCommand(keybindings, command, options).map((shortcut) => ({
            command,
            shortcut,
          })),
        ),
      )
      .catch(() => undefined);
    return () => {
      void preview.setForwardedShortcuts([]).catch(() => undefined);
    };
  }, [hasHistory, keybindings, terminalOpen]);

  return null;
}
