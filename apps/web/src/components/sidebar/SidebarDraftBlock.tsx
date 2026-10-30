import { SortableSidebarMarker } from "./SidebarListMarkers";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { discardComposerDraft } from "../../lib/discardComposerDraft";
import { replaceComposerContextReferences } from "@supaterm/shared/composerContextReferences";
import * as Schema from "effect/Schema";
import { SquarePenIcon } from "@supaterm/icons";
import {
  memo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { cn } from "~/lib/utils";
import { resolveSidebarRowAccessibility } from "../Sidebar.logic";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
  type ComposerThreadDraftState,
  type DraftSessionState,
} from "../../composerDraftStore";
import { useChatPaneStore } from "../../chatPanes/store";
import { useShallow } from "zustand/react/shallow";
import { SidebarDraftDiscardButton, draftPenClassName } from "./SidebarThreadRow";

const DRAFTS_SHELF_EXPANDED_KEY = "supaterm:sidebar:drafts-expanded";

const SidebarDraftRow = memo(function SidebarDraftRow(props: {
  draftId: DraftId;
  composer: ComposerThreadDraftState;
  branch: string | null;
  project: ProjectFaviconProject | null;
  projectDisplayName: string | null;
  isActive: boolean;
  /** Open in a chat pane that is not focused. */
  inOtherPane: boolean;
  onNavigate: (draftId: DraftId) => void;
  onDiscard: (draftId: DraftId) => void;
  onContextMenu: (draftId: DraftId, position: { x: number; y: number }) => void;
}) {
  const { composer, draftId, onContextMenu, onDiscard, onNavigate } = props;
  const promptPreview =
    replaceComposerContextReferences(composer.prompt, (occurrence) => occurrence.label)
      .trim()
      .split("\n", 1)[0] ?? "";
  // images mirrors persistedAttachments once rehydration finishes; before
  // that only the persisted list is populated, hence max not sum.
  const attachmentCount =
    Math.max(composer.images.length, composer.persistedAttachments.length) +
    composer.files.length +
    composer.terminalContexts.length +
    composer.previewAnnotations.length +
    composer.reviewComments.length;
  const preview =
    promptPreview.length > 0
      ? promptPreview
      : `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`;
  const accessibility = resolveSidebarRowAccessibility({
    title: preview,
    statusLabel: "Unsent draft",
    projectDisplayName: props.projectDisplayName,
    isActive: props.isActive,
  });
  const handleActivate = () => onNavigate(draftId);
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    // Keys targeting the nested discard button belong to the button:
    // preventDefault here would swallow Space's synthesized click and
    // navigate instead of discarding.
    if ((event.target as HTMLElement).closest("button")) return;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onContextMenu(draftId, { x: rect.left, y: rect.bottom });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onNavigate(draftId);
    }
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    onContextMenu(draftId, { x: event.clientX, y: event.clientY });
  };
  const handleDiscard = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onDiscard(draftId);
  };
  return (
    <li className="list-none">
      <Tooltip>
        <TooltipTrigger
          render={<div />}
          role="treeitem"
          tabIndex={-1}
          data-sidebar-row={`draft:${draftId}`}
          aria-label={accessibility.label}
          aria-current={accessibility.current}
          data-testid="sidebar-draft-row"
          className={cn(
            "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left text-sidebar-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            props.isActive
              ? "bg-sidebar-row-active"
              : props.inOtherPane
                ? "bg-sidebar-row-active/50 hover:bg-sidebar-row-hover"
                : "bg-transparent hover:bg-sidebar-row-hover",
          )}
          onClick={handleActivate}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
          onMouseDown={(event) => {
            if (event.button !== 1 || (event.target as HTMLElement).closest("button, a, input")) {
              return;
            }
            event.preventDefault();
          }}
          onAuxClick={(event) => {
            if (event.button !== 1 || (event.target as HTMLElement).closest("button, a, input")) {
              return;
            }
            handleDiscard(event);
          }}
        >
          <span className="sr-only">{preview}</span>
          <div className="relative z-10 h-12 px-2.5 pt-1.5">
            <div className="flex h-5 min-w-0 items-center gap-1.5">
              {props.project ? (
                <ProjectFavicon project={props.project} className="size-4 shrink-0" />
              ) : null}
              <span
                aria-hidden
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90"
              >
                {preview}
              </span>
              <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-end">
                <SidebarDraftDiscardButton onClick={handleDiscard}>
                  <SquarePenIcon aria-hidden className={draftPenClassName} />
                </SidebarDraftDiscardButton>
              </span>
            </div>
            <div className="mt-0.5 flex h-4 min-w-0 items-center text-xs text-secondary-label">
              <span className="min-w-0 truncate">{props.branch ?? props.projectDisplayName}</span>
            </div>
          </div>
        </TooltipTrigger>
        <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
          <ThreadHoverCard title={preview}>
            <div>Unsent draft</div>
            {props.projectDisplayName ? <div>{props.projectDisplayName}</div> : null}
          </ThreadHoverCard>
        </ThreadHoverCardPopup>
      </Tooltip>
    </li>
  );
});

interface SidebarDraftRowData {
  draftId: DraftId;
  session: DraftSessionState;
  composer: ComposerThreadDraftState;
}

// Own store subscriptions keep per-keystroke composer updates
// inside this block. Vanishes at count 0.
export const SidebarDraftBlock = memo(function SidebarDraftBlock(props: {
  projectByKey: ReadonlyMap<string, EnvironmentProject>;
  projectDisplayNameByKey: ReadonlyMap<string, string>;
  scopedProjectKeys: ReadonlySet<string> | null;
  routeDraftId: string | null;
  onNavigateToDraft: (draftId: DraftId) => void;
  onDraftContextMenu: (draftId: DraftId, position: { x: number; y: number }) => void;
}) {
  const [draftsShelfExpanded, setDraftsShelfExpanded] = useLocalStorage(
    DRAFTS_SHELF_EXPANDED_KEY,
    true,
    Schema.Boolean,
  );
  const toggleDraftsShelf = () => setDraftsShelfExpanded((value) => !value);
  const paneDraftIdList = useChatPaneStore(
    useShallow((state) =>
      (state.layout?.cells ?? []).flatMap((cell) =>
        cell.target.kind === "draft" ? [cell.target.draftId] : [],
      ),
    ),
  );
  const paneDraftIds = new Set(paneDraftIdList);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  const [frozenActive, setFrozenActive] = useState<{
    routeDraftId: string | null;
    row: SidebarDraftRowData | null;
  }>({ routeDraftId: null, row: null });
  if (frozenActive.routeDraftId !== props.routeDraftId) {
    let row: SidebarDraftRowData | null = null;
    if (props.routeDraftId !== null && props.routeDraftId.trim() !== "") {
      const draftId = DraftId.make(props.routeDraftId);
      const session = draftThreadsByThreadKey[draftId];
      const composer = draftsByThreadKey[draftId];
      row =
        session && session.promotedTo == null && composer && composerDraftHasUserContent(composer)
          ? { draftId, session, composer }
          : null;
    }
    setFrozenActive({ routeDraftId: props.routeDraftId, row });
  }
  const drafts = (() => {
    const rows: SidebarDraftRowData[] = [];
    for (const [draftKey, session] of Object.entries(draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (
        props.scopedProjectKeys !== null &&
        !props.scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
      ) {
        continue;
      }
      if (draftKey === props.routeDraftId) {
        if (frozenActive.routeDraftId === draftKey && frozenActive.row !== null) {
          rows.push(frozenActive.row);
        }
        continue;
      }
      const composer = draftsByThreadKey[draftKey];
      if (!composer || !composerDraftHasUserContent(composer)) {
        continue;
      }
      rows.push({ draftId: DraftId.make(draftKey), session, composer });
    }
    rows.sort((left, right) => right.session.createdAt.localeCompare(left.session.createdAt));
    return rows;
  })();
  if (drafts.length === 0) {
    return null;
  }
  const renderedDrafts = draftsShelfExpanded
    ? drafts
    : drafts.filter(({ draftId }) => draftId === props.routeDraftId || paneDraftIds.has(draftId));
  return (
    <SortableSidebarMarker marker="drafts-block">
      <ul role="presentation" className="flex flex-col gap-px">
        <li data-thread-selection-safe className="mx-0.5 h-8 list-none">
          <CollapsibleSectionHeader
            expanded={draftsShelfExpanded}
            onClick={toggleDraftsShelf}
            weight="normal"
            data-testid="sidebar-drafts-shelf-toggle"
          >
            {draftsShelfExpanded ? "Drafts" : `Drafts (${drafts.length})`}
          </CollapsibleSectionHeader>
        </li>
        {renderedDrafts.map(({ composer, draftId, session }) => {
          const projectKey = `${session.environmentId}:${session.projectId}`;
          return (
            <SidebarDraftRow
              key={draftId}
              branch={session.branch}
              draftId={draftId}
              composer={composer}
              project={props.projectByKey.get(projectKey) ?? null}
              projectDisplayName={props.projectDisplayNameByKey.get(projectKey) ?? null}
              isActive={draftId === props.routeDraftId}
              inOtherPane={draftId !== props.routeDraftId && paneDraftIds.has(draftId)}
              onNavigate={props.onNavigateToDraft}
              onDiscard={discardComposerDraft}
              onContextMenu={props.onDraftContextMenu}
            />
          );
        })}
      </ul>
    </SortableSidebarMarker>
  );
});
