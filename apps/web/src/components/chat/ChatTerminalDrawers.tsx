import type { ResolvedKeybindingsConfig } from "@supaterm/contracts";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@supaterm/client-runtime/environment";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePaneScope } from "../../chatPanes/paneScope";
import { useChatPaneStore } from "../../chatPanes/store";
import { useComposerDraftStore } from "../../composerDraftStore";
import type { TerminalContextSelection } from "../../lib/terminalContext";
import { usePanelAnimationSettings, usePanelPresence } from "../../panelAnimations";
import { useThreadRefs } from "../../state/entities";
import { useTerminalUiStateStore } from "../../terminalUiStateStore";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  reconcileMountedTerminalThreadIds,
} from "../ChatView.logic";
import {
  PersistentThreadTerminalDrawer,
  type PersistentTerminalLaunchContext,
} from "../PersistentThreadTerminals";

const EMPTY_THREAD_KEYS: ReadonlyArray<string> = [];

interface ChatTerminalDrawersProps {
  readonly activeThreadKey: string | null;
  readonly activeTerminalOpen: boolean;
  readonly composerHeight: number;
  readonly launchContext: PersistentTerminalLaunchContext | null;
  readonly focusRequestId: number;
  readonly splitShortcutLabel: string | undefined;
  readonly splitVerticalShortcutLabel: string | undefined;
  readonly newShortcutLabel: string | undefined;
  readonly closeShortcutLabel: string | undefined;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

/**
 * Keeps terminal drawers mounted for recently open threads, so switching back
 * to one finds its sessions as they were. Every thread's terminal and draft
 * state feeds the reconcile, so it subscribes here instead of in ChatView.
 */
export function ChatTerminalDrawers(props: ChatTerminalDrawersProps) {
  const { activeThreadKey } = props;
  const paneScope = usePaneScope();
  const openTerminalThreadKeys = useTerminalUiStateStore(
    useShallow((state) =>
      Object.entries(state.terminalUiStateByThreadKey).flatMap(
        ([nextThreadKey, nextTerminalUiState]) =>
          nextTerminalUiState.terminalOpen ? [nextThreadKey] : [],
      ),
    ),
  );
  const serverThreadRefs = useThreadRefs();
  const serverThreadKeys = serverThreadRefs.map(scopedThreadKey);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftThreadKeys = Object.values(draftThreadsByThreadKey).map((draftThread) =>
    scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
  );
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const activeTerminalDrawerPresence = usePanelPresence(
    Boolean(activeThreadKey && props.activeTerminalOpen),
    true,
    panelAnimationsActive,
    activeThreadKey,
    panelAnimationDurationMs,
  );
  const [mountedTerminalThreadKeys, setMountedTerminalThreadKeys] = useState<string[]>([]);
  // A thread's terminals attach once: a pane never keeps a hidden drawer for a thread another
  // pane shows, and the panes share one budget of hidden drawers.
  const otherPaneThreadKeys = useChatPaneStore(
    useShallow((state) =>
      paneScope === null || state.layout === null
        ? EMPTY_THREAD_KEYS
        : state.layout.cells.flatMap((cell) =>
            cell.id !== paneScope.paneId && cell.target.kind === "server"
              ? [scopedThreadKey(cell.target.threadRef)]
              : [],
          ),
    ),
  );
  const paneCount = useChatPaneStore((state) => state.layout?.cells.length ?? 1);
  const existingOpenTerminalThreadKeys = (() => {
    const existingThreadKeys = new Set<string>([...serverThreadKeys, ...draftThreadKeys]);
    return openTerminalThreadKeys.filter(
      (nextThreadKey) =>
        existingThreadKeys.has(nextThreadKey) && !otherPaneThreadKeys.includes(nextThreadKey),
    );
  })();
  const reconciledMountedTerminalThreadKeys = reconcileMountedTerminalThreadIds({
    currentThreadIds: mountedTerminalThreadKeys.filter(
      (mountedThreadKey) => !otherPaneThreadKeys.includes(mountedThreadKey),
    ),
    openThreadIds: existingOpenTerminalThreadKeys,
    activeThreadId: activeThreadKey,
    activeThreadTerminalOpen: activeTerminalDrawerPresence.present,
    maxHiddenThreadCount: Math.max(1, Math.floor(MAX_HIDDEN_MOUNTED_TERMINAL_THREADS / paneCount)),
  });
  if (
    mountedTerminalThreadKeys.length !== reconciledMountedTerminalThreadKeys.length ||
    mountedTerminalThreadKeys.some(
      (mountedThreadKey, index) => mountedThreadKey !== reconciledMountedTerminalThreadKeys[index],
    )
  ) {
    setMountedTerminalThreadKeys(reconciledMountedTerminalThreadKeys);
  }
  const mountedTerminalThreadRefs = mountedTerminalThreadKeys.flatMap((mountedThreadKey) => {
    const mountedThreadRef = parseScopedThreadKey(mountedThreadKey);
    return mountedThreadRef ? [{ key: mountedThreadKey, threadRef: mountedThreadRef }] : [];
  });

  return mountedTerminalThreadRefs.map(({ key: mountedThreadKey, threadRef: mountedThreadRef }) => (
    <PersistentThreadTerminalDrawer
      key={mountedThreadKey}
      threadRef={mountedThreadRef}
      threadId={mountedThreadRef.threadId}
      active={mountedThreadKey === activeThreadKey}
      composerHeight={mountedThreadKey === activeThreadKey ? props.composerHeight : 0}
      launchContext={mountedThreadKey === activeThreadKey ? props.launchContext : null}
      focusRequestId={mountedThreadKey === activeThreadKey ? props.focusRequestId : 0}
      splitShortcutLabel={props.splitShortcutLabel}
      splitVerticalShortcutLabel={props.splitVerticalShortcutLabel}
      newShortcutLabel={props.newShortcutLabel}
      closeShortcutLabel={props.closeShortcutLabel}
      keybindings={props.keybindings}
      onAddTerminalContext={props.onAddTerminalContext}
    />
  ));
}
