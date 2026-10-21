const THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS = "bg-transparent shadow-none";

const THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS =
  "hover:!bg-black/[0.035] data-pressed:!bg-black/[0.035] dark:hover:!bg-white/[0.08] dark:data-pressed:!bg-white/[0.08]";

const THREAD_DETAILS_PANEL_HALF_HOVER_SURFACE_CLASS =
  "hover:bg-black/[0.035] dark:hover:bg-white/[0.08]";

const THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS = `${THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS} ${THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_ROW_HEIGHT_CLASS = "h-7 pointer-coarse:h-11";

const THREAD_DETAILS_PANEL_TEXT_CLASS = "text-[13px] leading-4 font-medium text-foreground/80";

export const THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS = "gap-2 px-2 text-left";

// The row supplies the first tint; the hovered or open segment adds a second tint.
const THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS = `${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS} data-popup-open:!bg-black/[0.035] dark:data-popup-open:!bg-white/[0.08]`;

const THREAD_DETAILS_PANEL_CONTROL_CLASS = `${THREAD_DETAILS_PANEL_ROW_HEIGHT_CLASS} min-w-0 rounded-lg border-transparent ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} ${THREAD_DETAILS_PANEL_TEXT_CLASS}`;
const THREAD_DETAILS_PANEL_SPLIT_GROUP_SURFACE_CLASS = `${THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS} has-[[data-popup-open]]:bg-black/[0.035] dark:has-[[data-popup-open]]:bg-white/[0.08]`;

export const THREAD_DETAILS_PANEL_ROW_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} w-full justify-start ${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_LINK_SPLIT_GROUP_CLASS = `group/thread-details-link flex w-full items-center rounded-lg ${THREAD_DETAILS_PANEL_SPLIT_GROUP_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_LINK_SPLIT_PRIMARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} flex-1 justify-start rounded-e-none ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

/** The trailing half of a link split row when it carries a word ("Merge") rather than an icon. */
export const THREAD_DETAILS_PANEL_LINK_SPLIT_ACTION_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} shrink-0 justify-center rounded-s-none text-primary ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;
export const THREAD_DETAILS_PANEL_SELECT_ROW_CLASS = `${THREAD_DETAILS_PANEL_ROW_CLASS} gap-0 px-0 [&_[data-slot=select-icon]]:-me-px [&_[data-slot=select-icon]]:relative [&_[data-slot=select-icon]]:flex [&_[data-slot=select-icon]]:h-full [&_[data-slot=select-icon]]:w-7 pointer-coarse:[&_[data-slot=select-icon]]:w-11 [&_[data-slot=select-icon]]:shrink-0 [&_[data-slot=select-icon]]:items-center [&_[data-slot=select-icon]]:justify-center [&_[data-slot=select-icon]]:before:absolute [&_[data-slot=select-icon]]:before:-left-px [&_[data-slot=select-icon]]:before:top-1/2 [&_[data-slot=select-icon]]:before:h-4 [&_[data-slot=select-icon]]:before:w-px [&_[data-slot=select-icon]]:before:-translate-y-1/2 [&_[data-slot=select-icon]]:before:bg-border/65 [&_[data-slot=select-icon]>svg]:me-0 [&_[data-slot=select-icon]>svg]:size-4 [&_[data-slot=select-icon]>svg]:text-muted-foreground [&_[data-slot=select-icon]>svg]:opacity-100`;

// The row keeps its soft fill while each half stacks a second one, like the split controls nearby.
export const THREAD_DETAILS_PANEL_SELECT_LABEL_CLASS = `flex h-full min-w-0 flex-1 items-center rounded-s-lg ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} ${THREAD_DETAILS_PANEL_HALF_HOVER_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SELECT_ICON_CLASS = `rounded-e-lg ${THREAD_DETAILS_PANEL_HALF_HOVER_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS = `${THREAD_DETAILS_PANEL_ROW_HEIGHT_CLASS} w-full min-w-0 justify-start rounded-lg border border-transparent ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} ${THREAD_DETAILS_PANEL_TEXT_CLASS} sm:h-7 sm:text-[13px] pointer-coarse:sm:h-11`;

export const THREAD_DETAILS_PANEL_ICON_CLASS =
  "pointer-events-none size-4 shrink-0 text-muted-foreground";

export const THREAD_DETAILS_PANEL_CHEVRON_CLASS = "size-4 shrink-0 text-muted-foreground";

export const THREAD_DETAILS_PANEL_ICON_ACTION_CLASS = `size-6 pointer-coarse:size-11 justify-center rounded-md border-transparent bg-transparent p-0 ${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS = `group/thread-details-action flex w-full items-center rounded-lg ${THREAD_DETAILS_PANEL_SPLIT_GROUP_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_PRIMARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} flex-1 justify-start rounded-e-none ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_SECONDARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} w-7 pointer-coarse:w-11 justify-center rounded-s-none px-0 ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS = "h-4 w-px shrink-0 bg-border/65";

export const THREAD_DETAILS_PANEL_SPLIT_CHECKS_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} min-w-7 pointer-coarse:min-w-11 justify-center gap-1.5 rounded-none ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;
