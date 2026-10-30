import { ArrowUpIcon, BookmarkIcon, FileIcon, FileTextIcon, XIcon } from "@supaterm/icons";
import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { assistantCitationsToPlainText } from "@supaterm/shared/assistantCitations";

import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { RelativeTime } from "../RelativeTime";
import { cn } from "~/lib/utils";
import { type PromptStashEntry } from "../../promptStashStore";
import { InlineConfirmIcon, InlineConfirmTooltip } from "../InlineConfirm";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerBanner } from "./ComposerBanner";
import { useIsPaneInputOwner } from "../../chatPanes/paneScope";

const SNIPPET_MAX_CHARS = 90;

function missingImageCount(entry: PromptStashEntry): number {
  return entry.droppedImageNames.length + (entry.unreadableImageNames?.length ?? 0);
}

function stashEntrySnippet(entry: PromptStashEntry): string {
  const trimmed = assistantCitationsToPlainText(entry.prompt).trim().replace(/\s+/g, " ");
  if (trimmed.length > 0) {
    return trimmed.length > SNIPPET_MAX_CHARS ? `${trimmed.slice(0, SNIPPET_MAX_CHARS)}…` : trimmed;
  }
  const imageCount = entry.attachments.length + entry.droppedImageNames.length;
  const fileCount = entry.files?.length ?? 0;
  const attachmentCount = imageCount + fileCount;
  if (attachmentCount === 0) {
    return "(empty)";
  }
  const label = imageCount > 0 && fileCount > 0 ? "attachment" : fileCount > 0 ? "file" : "image";
  return `(${attachmentCount} ${label}${attachmentCount === 1 ? "" : "s"})`;
}

/**
 * The listener runs capture-phase on window so it wins over the composer's handlers while the
 * menu is open.
 */
export const ComposerStashMenu = memo(function ComposerStashMenu(props: {
  entries: ReadonlyArray<PromptStashEntry>;
  stashShortcutLabel: string | null;
  sendAllBlockedReason: string | null;
  composerFormRef: RefObject<HTMLFormElement | null>;
  onRestore: (entry: PromptStashEntry) => void;
  onDelete: (entry: PromptStashEntry) => void;
  onSendAll: () => void;
  onClose: () => void;
}) {
  const {
    entries,
    stashShortcutLabel,
    composerFormRef,
    sendAllBlockedReason,
    onRestore,
    onDelete,
    onSendAll,
    onClose,
  } = props;
  // Its keys are window-wide, so the menu closes once its chat pane is no longer the one in use.
  const ownsInput = useIsPaneInputOwner();
  useEffect(() => {
    if (!ownsInput) onClose();
  }, [onClose, ownsInput]);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(entries[0]?.id ?? null);
  const confirm = useInlineConfirm<string>();
  const sendAllConfirm = useInlineConfirm<"send-all">();
  const sendAllArmed = sendAllConfirm.armed === "send-all";

  const highlightedEntry = entries.find((entry) => entry.id === highlightedId) ?? entries[0];

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Dismisses the open menu on document pointer events outside its drawer.
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const drawer = drawerRef.current;
      if (
        (drawer && event.composedPath().includes(drawer)) ||
        (event.target instanceof Element &&
          event.target.closest('[data-prompt-stash-badge="true"]'))
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [onClose]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Owns capture-phase keyboard navigation while the stash menu is mounted.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        (target !== document.body &&
          !(target instanceof Element && target.closest('[data-prompt-stash-badge="true"]')) &&
          !drawerRef.current?.contains(target) &&
          !composerFormRef.current?.querySelector('textarea, [role="textbox"]')?.contains(target))
      ) {
        return;
      }
      if (event.key === "Escape") {
        if (confirm.armed !== null || sendAllConfirm.armed !== null) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (entries.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = entries.findIndex((entry) => entry.id === highlightedEntry?.id);
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const normalizedIndex = currentIndex >= 0 ? currentIndex : offset === 1 ? -1 : 0;
        const nextIndex = (normalizedIndex + offset + entries.length) % entries.length;
        setHighlightedId(entries[nextIndex]?.id ?? null);
        const nextButton =
          drawerRef.current?.querySelectorAll<HTMLButtonElement>("[data-stash-restore]")[nextIndex];
        nextButton?.scrollIntoView({ block: "nearest" });
        if (drawerRef.current?.contains(document.activeElement)) {
          nextButton?.focus({ preventScroll: true });
        }
        return;
      }
      if (event.key === "Enter") {
        if (event.target instanceof HTMLElement && event.target.closest("button")) {
          return;
        }
        if (!highlightedEntry) return;
        event.preventDefault();
        event.stopPropagation();
        onRestore(highlightedEntry);
        return;
      }
      if (event.key === "Backspace" && (event.metaKey || event.ctrlKey)) {
        if (!highlightedEntry) return;
        event.preventDefault();
        event.stopPropagation();
        onDelete(highlightedEntry);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    composerFormRef,
    confirm.armed,
    sendAllConfirm.armed,
    entries,
    highlightedEntry,
    onClose,
    onDelete,
    onRestore,
  ]);

  return (
    <ComposerBanner.Root ref={drawerRef} data-composer-stash-drawer="true">
      <ComposerBanner.Row className="relative pb-1">
        <ComposerBanner.Icon>
          <BookmarkIcon />
        </ComposerBanner.Icon>
        <ComposerBanner.Content className="text-muted-foreground">
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1 outline-none before:absolute before:inset-0 before:rounded-md focus-visible:before:outline-2 focus-visible:before:-outline-offset-2 focus-visible:before:outline-ring"
            aria-label="Close stash"
            aria-expanded="true"
            onPointerDown={(event) => event.preventDefault()}
            onClick={onClose}
          >
            Stash
            <ComposerBanner.Count>{entries.length}</ComposerBanner.Count>
          </button>
        </ComposerBanner.Content>
        <ComposerBanner.Actions>
          {entries.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                closeOnClick={sendAllArmed}
                render={
                  <Button
                    size="compact"
                    variant="outline"
                    className="z-10"
                    aria-disabled={sendAllBlockedReason !== null}
                    aria-label={sendAllArmed ? "Confirm send all" : "Send all"}
                    onPointerDown={(event) => event.preventDefault()}
                    {...(sendAllBlockedReason === null
                      ? sendAllConfirm.bind("send-all", onSendAll)
                      : {})}
                  />
                }
              >
                <InlineConfirmIcon armed={sendAllArmed}>
                  <ArrowUpIcon className="size-3.5" />
                </InlineConfirmIcon>
                <span className="inline-grid" aria-hidden>
                  <span className={cn("col-start-1 row-start-1", sendAllArmed && "invisible")}>
                    Send all
                  </span>
                  <span className={cn("col-start-1 row-start-1", !sendAllArmed && "invisible")}>
                    Confirm
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipPopup>
                {sendAllBlockedReason ??
                  (sendAllArmed
                    ? `Click again to send ${entries.length === 1 ? "this prompt" : `all ${entries.length} prompts`}`
                    : "Send each prompt as its own message, oldest first")}
              </TooltipPopup>
            </Tooltip>
          )}
          <ComposerBanner.ToggleIcon expanded />
        </ComposerBanner.Actions>
      </ComposerBanner.Row>
      <ComposerBanner.Scroll>
        <ComposerBanner.Children render={<ul role="list" />} aria-label="Stashed prompts">
          {entries.length === 0 ? (
            <ComposerBanner.Row render={<li />}>
              <ComposerBanner.Icon />
              <ComposerBanner.Content className="text-muted-foreground">
                Nothing stashed yet.
                {stashShortcutLabel
                  ? ` Press ${stashShortcutLabel} with a prompt in the composer to stash it.`
                  : null}
              </ComposerBanner.Content>
            </ComposerBanner.Row>
          ) : (
            entries.map((entry) => (
              <ComposerBanner.Row
                render={<li />}
                key={entry.id}
                data-stash-entry={entry.id}
                data-highlighted={highlightedEntry?.id === entry.id || undefined}
                className={cn(
                  "relative rounded-sm",
                  highlightedEntry?.id === entry.id && "bg-accent text-accent-foreground",
                )}
                onMouseMove={() => {
                  if (highlightedId !== entry.id) setHighlightedId(entry.id);
                }}
                onFocus={() => setHighlightedId(entry.id)}
              >
                <ComposerBanner.Icon>
                  <FileTextIcon />
                </ComposerBanner.Icon>
                <ComposerBanner.Content>
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer truncate text-left text-foreground/80 outline-none before:absolute before:inset-0 before:rounded-sm focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-ring"
                    data-stash-restore={entry.id}
                    aria-label={`Restore stashed prompt: ${stashEntrySnippet(entry)}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onRestore(entry)}
                  >
                    {stashEntrySnippet(entry)}
                  </button>
                </ComposerBanner.Content>
                <ComposerBanner.Actions>
                  {entry.pendingImageCount ? (
                    <span className="shrink-0 text-muted-foreground">
                      saving {entry.pendingImageCount} image
                      {entry.pendingImageCount === 1 ? "" : "s"}…
                    </span>
                  ) : missingImageCount(entry) > 0 ? (
                    <span className="shrink-0 text-warning-foreground">
                      {missingImageCount(entry)} image
                      {missingImageCount(entry) === 1 ? "" : "s"} dropped
                    </span>
                  ) : null}
                  {entry.attachments.length > 0 ? (
                    <span className="flex shrink-0 items-center -space-x-1.5">
                      {entry.attachments.slice(0, 3).map((attachment) => (
                        <img
                          key={attachment.id}
                          src={attachment.dataUrl}
                          alt=""
                          aria-hidden="true"
                          className="size-4 rounded border border-border/70 object-cover"
                        />
                      ))}
                    </span>
                  ) : null}
                  {(entry.files?.length ?? 0) > 0 ? (
                    <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                      <FileIcon className="size-3" aria-hidden />
                      {entry.files!.length}
                    </span>
                  ) : null}
                  <time
                    dateTime={entry.createdAt}
                    className="shrink-0 text-muted-foreground tabular-nums max-sm:hidden"
                  >
                    <RelativeTime timestamp={entry.createdAt} />
                  </time>
                  <InlineConfirmTooltip
                    armed={confirm.armed === entry.id}
                    tip="Delete stashed prompt"
                    armedTip="Click again to delete this stashed prompt"
                    render={
                      <ComposerBanner.Dismiss
                        className="z-10"
                        aria-label={
                          confirm.armed === entry.id ? "Confirm delete" : "Delete stashed prompt"
                        }
                        onPointerDown={(event) => event.preventDefault()}
                        {...confirm.bind(entry.id, () => onDelete(entry))}
                      />
                    }
                  >
                    <InlineConfirmIcon armed={confirm.armed === entry.id}>
                      <XIcon className="size-3.5" />
                    </InlineConfirmIcon>
                  </InlineConfirmTooltip>
                </ComposerBanner.Actions>
              </ComposerBanner.Row>
            ))
          )}
        </ComposerBanner.Children>
      </ComposerBanner.Scroll>
    </ComposerBanner.Root>
  );
});
