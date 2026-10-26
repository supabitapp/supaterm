import { InfoIcon } from "@supaterm/icons";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { animationsSettled } from "~/lib/motion";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerBanner, type ComposerBannerVariant } from "./ComposerBanner";
import { observeResize } from "~/lib/observeResize";

export interface ComposerBannerStackItem {
  readonly id: string;
  readonly variant: ComposerBannerVariant;
  readonly priority?: "urgent" | "activity" | "notice";
  readonly alwaysVisible?: boolean;
  readonly icon: ReactNode;
  /** The icon holds a control, so it stays in the accessibility tree. */
  readonly iconInteractive?: boolean;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

export type ComposerBannerStackContent = Pick<
  ComposerBannerStackItem,
  "id" | "variant" | "priority" | "alwaysVisible"
> & { readonly content: ReactNode };

type ComposerBannerStackEntry = ComposerBannerStackItem | ComposerBannerStackContent;

function bannerPriority(item: ComposerBannerStackEntry) {
  if (item.priority === "activity") {
    return 0;
  }
  if (item.priority === "urgent" || item.variant === "error" || item.variant === "warning") {
    return 1;
  }
  return 2;
}

interface StackSlot {
  readonly item: ComposerBannerStackEntry;
  readonly exiting: boolean;
  /** Exiting notices only leave from the slot they occupied; stacked ones never surface. */
  readonly wasFront: boolean;
  /** Set for the commit that mounts the slot, so `starting:` styles replay only then. */
  readonly entering: boolean;
}

// The activity row trades places with the strip outside the stack, so it never animates.
const animates = (item: ComposerBannerStackEntry) => item.priority !== "activity";

const staysVisible = (item: ComposerBannerStackEntry) =>
  item.priority === "activity" || item.alwaysVisible === true;

function arrangeSlots(slots: ReadonlyArray<StackSlot>) {
  const ordered = slots.toSorted((a, b) => bannerPriority(a.item) - bannerPriority(b.item));
  const front = ordered.find((slot) => !slot.exiting || slot.wasFront);
  return { front, stacked: ordered.filter((slot) => slot !== front) };
}

/** Keeps removed notices where they were, marked exiting, until their exit transition ends. */
function reconcileStackSlots(
  previous: ReadonlyArray<StackSlot>,
  live: ReadonlyArray<ComposerBannerStackEntry>,
): ReadonlyArray<StackSlot> {
  const liveIds = new Set(live.map((item) => item.id));
  const previousLiveIds = new Set(previous.flatMap((slot) => (slot.exiting ? [] : [slot.item.id])));
  const previousFront = arrangeSlots(previous).front;
  const exitingAfter = new Map<string | null, StackSlot[]>();
  let anchor: string | null = null;
  for (const slot of previous) {
    if (liveIds.has(slot.item.id)) {
      anchor = slot.item.id;
      continue;
    }
    if (!animates(slot.item)) continue;
    const exiting = slot.exiting
      ? slot
      : { ...slot, exiting: true, entering: false, wasFront: slot === previousFront };
    exitingAfter.set(anchor, [...(exitingAfter.get(anchor) ?? []), exiting]);
  }
  return [
    ...(exitingAfter.get(null) ?? []),
    ...live.flatMap((item) => [
      {
        item,
        exiting: false,
        wasFront: false,
        entering: !previousLiveIds.has(item.id) && animates(item),
      },
      ...(exitingAfter.get(item.id) ?? []),
    ]),
  ];
}

/** Drops a finished exit. A notice revealed by the front's exit rises into its place. */
function releaseStackSlot(slots: ReadonlyArray<StackSlot>, id: string): ReadonlyArray<StackSlot> {
  const released = slots.find((slot) => slot.exiting && slot.item.id === id);
  if (!released) return slots;
  const remaining = slots.flatMap((slot) =>
    slot === released ? [] : [slot.entering ? { ...slot, entering: false } : slot],
  );
  if (arrangeSlots(slots).front !== released) return remaining;
  const revealed = arrangeSlots(remaining).front;
  return revealed && !revealed.exiting && animates(revealed.item)
    ? remaining.map((slot) => (slot === revealed ? { ...slot, entering: true } : slot))
    : remaining;
}

// The banner fades itself (see ComposerBanner.Root) so its glass keeps its blur.
const presenceClassName =
  "transition-[translate] duration-200 ease-drawer data-enter:starting:translate-y-1 data-ending-style:pointer-events-none data-ending-style:translate-y-2 data-ending-style:duration-150 data-ending-style:ease-in motion-reduce:transition-none";

interface ComposerBannerStackProps {
  readonly className?: string;
  readonly items: ReadonlyArray<ComposerBannerStackEntry>;
}

export function ComposerBannerStack({ className, items }: ComposerBannerStackProps) {
  const [stackExpanded, setStackExpanded] = useState(false);
  const noticesRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLButtonElement>(null);
  const expandedItemsRef = useRef<HTMLDivElement>(null);
  const slotElementsRef = useRef(new Map<string, HTMLElement>());
  const expandedItemsId = useId();
  // A dismissed notice leaves at once, even if its owner removes it asynchronously.
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => new Set());
  const presentDismissedIds = [...dismissedIds].filter((id) =>
    items.some((item) => item.id === id),
  );
  if (presentDismissedIds.length !== dismissedIds.size) {
    setDismissedIds(new Set(presentDismissedIds));
  }
  const live = dismissedIds.size === 0 ? items : items.filter((item) => !dismissedIds.has(item.id));
  const liveKey = live.map((item) => item.id).join("\n");
  const [stack, setStack] = useState<{
    readonly liveKey: string;
    readonly slots: ReadonlyArray<StackSlot>;
  }>(() => ({
    liveKey,
    slots: live.map((item) => ({ item, exiting: false, wasFront: false, entering: false })),
  }));
  if (stack.liveKey !== liveKey) {
    setStack({ liveKey, slots: reconcileStackSlots(stack.slots, live) });
  }
  // Content changes every parent render; only the set of notices goes through state.
  const slots = stack.slots.map((slot) => {
    const fresh = slot.exiting ? undefined : live.find((item) => item.id === slot.item.id);
    return fresh && fresh !== slot.item ? { ...slot, item: fresh } : slot;
  });
  const exitingKey = slots.flatMap((slot) => (slot.exiting ? [slot.item.id] : [])).join("\n");
  const { front, stacked } = arrangeSlots(slots);
  const stackedVisible = stacked.filter((slot) => staysVisible(slot.item));
  const stackedNotices = stacked.filter((slot) => !staysVisible(slot.item));
  const hasStack = stackedNotices.length > 0;

  useEffect(() => {
    if (exitingKey === "") return;
    let cancelled = false;
    for (const id of exitingKey.split("\n")) {
      const slot = slotElementsRef.current.get(id);
      void (slot ? animationsSettled(slot, { subtree: true }) : Promise.resolve()).then(() => {
        if (cancelled) return;
        setStack((current) => ({ ...current, slots: releaseStackSlot(current.slots, id) }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [exitingKey, slotElementsRef]);

  if (!hasStack && stackExpanded) {
    setStackExpanded(false);
  }

  const expandAndFocusNotice = () => {
    flushSync(() => setStackExpanded(true));
    const container = expandedItemsRef.current;
    const firstControl = container?.querySelector<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
    );
    (firstControl ?? container)?.focus({ preventScroll: true });
  };

  if (!front) {
    return null;
  }
  const firstStackedItem = (stackedNotices.find((slot) => !slot.exiting) ?? stackedNotices[0])
    ?.item;
  const showCollapsedStackCap = firstStackedItem !== undefined && !front.exiting;
  const stackLeaving = stackedNotices.every((slot) => slot.exiting);

  const slotProps = (slot: StackSlot) => ({
    ref: (element: HTMLDivElement | null) => {
      if (element) slotElementsRef.current.set(slot.item.id, element);
      else slotElementsRef.current.delete(slot.item.id);
    },
    "data-enter": slot.entering ? "" : undefined,
    "data-ending-style": slot.exiting ? "" : undefined,
  });

  const requestDismiss = (item: ComposerBannerStackEntry) => {
    if (!("onDismiss" in item) || !item.onDismiss || dismissedIds.has(item.id)) {
      return;
    }
    setDismissedIds(new Set(dismissedIds).add(item.id));
    item.onDismiss();
  };

  return (
    <>
      {hasStack ? (
        <div
          ref={noticesRef}
          data-composer-banner-stack="true"
          data-chat-composer-collapsed-controls="true"
          className={cn("relative z-20 min-h-3", stackExpanded && "z-50")}
          onPointerEnter={(event) => {
            if (event.pointerType === "touch") return;
            if (document.activeElement === peekRef.current) {
              expandAndFocusNotice();
              return;
            }
            setStackExpanded(true);
          }}
          onPointerLeave={(event) => {
            if (!event.currentTarget.contains(document.activeElement)) setStackExpanded(false);
          }}
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget) &&
              !event.currentTarget.matches(":hover")
            ) {
              setStackExpanded(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !stackExpanded) return;
            event.preventDefault();
            event.stopPropagation();
            flushSync(() => setStackExpanded(false));
            peekRef.current?.focus({ preventScroll: true });
          }}
        >
          {showCollapsedStackCap ? (
            <ComposerBanner.Peek
              ref={peekRef}
              variant={firstStackedItem.variant}
              aria-label="Show other notices"
              aria-expanded={stackExpanded}
              aria-controls={expandedItemsId}
              aria-hidden={stackExpanded || undefined}
              tabIndex={stackExpanded ? -1 : 0}
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                expandAndFocusNotice();
              }}
              className={cn(
                (stackExpanded || stackLeaving) && "pointer-events-none invisible opacity-0",
              )}
            />
          ) : null}
          <div
            id={expandedItemsId}
            ref={expandedItemsRef}
            role="group"
            aria-label="Other notices"
            tabIndex={-1}
            data-composer-banner-stack-expanded-items="true"
            className={cn(
              "grid transition-[grid-template-rows] duration-150 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
              stackExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="min-h-0 overflow-y-clip">
              <div
                className={cn(
                  "space-y-2 pb-2 transition-[opacity,translate,visibility] duration-150 ease-out motion-reduce:transition-none",
                  stackExpanded
                    ? "pointer-events-auto visible translate-y-0 opacity-100"
                    : "pointer-events-none invisible translate-y-1 opacity-0",
                )}
              >
                {stackedNotices.map((slot) => (
                  <div key={slot.item.id} {...slotProps(slot)} className={presenceClassName}>
                    <ComposerBannerStackAlert
                      slot={slot}
                      attached={false}
                      onDismissRequest={() => requestDismiss(slot.item)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {stackedVisible.length > 0 ? (
        <div className="relative z-20 space-y-2 pb-2" data-chat-composer-collapsed-controls="true">
          {stackedVisible.map((slot) => (
            <div key={slot.item.id} {...slotProps(slot)} className={presenceClassName}>
              <ComposerBannerStackAlert
                slot={slot}
                attached={false}
                onDismissRequest={() => requestDismiss(slot.item)}
              />
            </div>
          ))}
        </div>
      ) : null}
      <ComposerBanner.Attachment
        className={className}
        data-composer-banner-drawer="true"
        data-chat-composer-collapsed-controls="true"
      >
        <div
          key={front.item.id}
          {...slotProps(front)}
          className={cn("relative z-10", presenceClassName)}
          onPointerDownCapture={() => {
            setStackExpanded(false);
            const activeElement = document.activeElement;
            if (
              activeElement instanceof HTMLElement &&
              noticesRef.current?.contains(activeElement)
            ) {
              activeElement.blur();
            }
          }}
        >
          <ComposerBannerStackAlert
            slot={front}
            attached
            onDismissRequest={() => requestDismiss(front.item)}
          />
        </div>
      </ComposerBanner.Attachment>
    </>
  );
}

function NoticeText({
  children,
  className,
  detailsLabel,
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly detailsLabel: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const detailsRef = useRef<HTMLButtonElement>(null);
  const [showDetails, setShowDetails] = useState(false);

  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    const measure = () => {
      // Ignore the space taken by the details button itself so it cannot
      // sustain its own overflow after the text would otherwise fit.
      const recoveredWidth = detailsRef.current ? detailsRef.current.offsetWidth + 4 : 0;
      const hidden = getComputedStyle(text).position === "absolute";
      setShowDetails(
        hidden ||
          [text, ...text.querySelectorAll("*")].some(
            (element) => element.scrollWidth > element.clientWidth + recoveredWidth,
          ),
      );
    };
    measure();
    const stopObserving = observeResize(text, measure);
    const mutations = new MutationObserver(measure);
    mutations.observe(text, { childList: true, subtree: true, characterData: true });
    return () => {
      stopObserving();
      mutations.disconnect();
    };
  }, []);

  return (
    <span className="contents">
      <span ref={textRef} className={className}>
        {children}
      </span>
      {showDetails ? (
        <Popover>
          <PopoverTrigger
            openOnHover
            render={
              <Button
                ref={detailsRef}
                size="icon-xs"
                variant="ghost-muted"
                aria-label={detailsLabel}
                className="flex-none"
              />
            }
          >
            <InfoIcon />
          </PopoverTrigger>
          <PopoverPopup
            aria-label="Notice details"
            tooltipStyle
            side="top"
            className="max-w-[min(30rem,calc(100vw-2rem))] whitespace-normal wrap-anywhere [--inline-button-text-align:start] [--inline-button-white-space:normal] [&_[data-slot=inline-button]]:max-w-full"
          >
            <ComposerBanner.Scroll className="max-h-[min(var(--available-height),24rem,40dvh)]">
              {children}
            </ComposerBanner.Scroll>
          </PopoverPopup>
        </Popover>
      ) : null}
    </span>
  );
}

function ComposerBannerStackAlert({
  slot: { item, entering, exiting },
  attached,
  onDismissRequest,
}: {
  readonly slot: StackSlot;
  readonly attached: boolean;
  readonly onDismissRequest: () => void;
}) {
  const presence = {
    "data-enter": entering ? "" : undefined,
    "data-ending-style": exiting ? "" : undefined,
  };
  if ("content" in item) {
    return (
      <ComposerBanner.Root
        density="comfortable"
        placement={attached ? "attached" : "floating"}
        variant={item.variant}
        {...presence}
      >
        {item.content}
      </ComposerBanner.Root>
    );
  }
  return (
    <ComposerBanner.Root
      role="alert"
      placement={attached ? "attached" : "floating"}
      variant={item.variant}
      density="comfortable"
      {...presence}
    >
      <ComposerBanner.Row layout={item.priority === "activity" ? "inline" : "wrap-actions"}>
        <ComposerBanner.Icon
          className="h-(--composer-banner-icon-column) self-start"
          aria-hidden={item.iconInteractive ? undefined : true}
        >
          {item.icon}
        </ComposerBanner.Icon>
        <ComposerBanner.Content className="whitespace-nowrap">
          <NoticeText
            detailsLabel="Show title details"
            className="min-w-0 truncate font-medium leading-7 sm:leading-6"
          >
            {item.title}
          </NoticeText>
          {item.description ? (
            <NoticeText
              detailsLabel="Show notice details"
              className="w-0 min-w-0 grow truncate text-muted-foreground @max-[400px]:sr-only"
            >
              {item.description}
            </NoticeText>
          ) : null}
        </ComposerBanner.Content>
        {item.actions || item.onDismiss ? (
          <ComposerBanner.Actions>
            {item.actions}
            {item.onDismiss ? (
              <ComposerBanner.Dismiss
                aria-label={item.dismissLabel ?? "Dismiss warning"}
                disabled={exiting}
                onClick={onDismissRequest}
              />
            ) : null}
          </ComposerBanner.Actions>
        ) : null}
      </ComposerBanner.Row>
      {item.children ? <ComposerBanner.Children>{item.children}</ComposerBanner.Children> : null}
    </ComposerBanner.Root>
  );
}
