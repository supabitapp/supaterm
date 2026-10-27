import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { ComboboxTrigger } from "../ui/combobox";
import { ComposerControl } from "./ComposerControl";
import {
  THREAD_DETAILS_PANEL_ROW_CLASS,
  THREAD_DETAILS_PANEL_SELECT_ROW_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_PRIMARY_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SECONDARY_CLASS,
  THREAD_DETAILS_PANEL_LINK_SPLIT_ACTION_CLASS,
  THREAD_DETAILS_PANEL_LINK_SPLIT_PRIMARY_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_CHECKS_CLASS,
  THREAD_DETAILS_PANEL_ICON_ACTION_CLASS,
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_SELECT_LABEL_CLASS,
  THREAD_DETAILS_PANEL_SELECT_ICON_CLASS,
} from "./threadDetailsPanelStyles";
import { ChevronDownIcon } from "@supaterm/icons";

const parts = {
  "group-row": `${THREAD_DETAILS_PANEL_ROW_CLASS} hover:!bg-transparent dark:hover:!bg-transparent`,
  row: THREAD_DETAILS_PANEL_ROW_CLASS,
  select: THREAD_DETAILS_PANEL_SELECT_ROW_CLASS,
  primary: THREAD_DETAILS_PANEL_SPLIT_PRIMARY_CLASS,
  secondary: THREAD_DETAILS_PANEL_SPLIT_SECONDARY_CLASS,
  action: THREAD_DETAILS_PANEL_LINK_SPLIT_ACTION_CLASS,
  "link-primary": THREAD_DETAILS_PANEL_LINK_SPLIT_PRIMARY_CLASS,
  checks: THREAD_DETAILS_PANEL_SPLIT_CHECKS_CLASS,
  icon: THREAD_DETAILS_PANEL_ICON_ACTION_CLASS,
};

export function ThreadDetailsControl({
  panel = true,
  part = "row",
  multiline = false,
  tone = "default",
  className,
  size = "default",
  variant = "default",
  render,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  panel?: boolean;
  part?: keyof typeof parts;
  multiline?: boolean;
  tone?: "default" | "muted" | "destructive";
}) {
  const control = useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(
      {
        type: render ? undefined : "button",
        className: cn(
          "relative inline-flex shrink-0 cursor-pointer items-center whitespace-nowrap border outline-none transition-[background-color,color,box-shadow,scale] duration-150 ease-out [&:active:not([aria-haspopup])]:scale-[0.96] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-muted-foreground/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 [&_svg]:shrink-0",
          parts[part],
          multiline &&
            "h-auto min-h-7 py-0.75 disabled:opacity-100 pointer-coarse:h-auto pointer-coarse:min-h-11",
          tone === "muted" && "text-muted-foreground/70 hover:text-foreground/80",
          tone === "destructive" &&
            "text-destructive hover:text-destructive data-pressed:text-destructive",
          className,
        ),
      },
      props,
      {
        children:
          part === "select" ? (
            <>
              <span data-slot="select-label" className={THREAD_DETAILS_PANEL_SELECT_LABEL_CLASS}>
                {children}
              </span>
              <span data-slot="select-icon" className={THREAD_DETAILS_PANEL_SELECT_ICON_CLASS}>
                <ChevronDownIcon className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} />
              </span>
            </>
          ) : (
            children
          ),
      },
    ),
  });
  if (!panel) {
    return (
      <Button
        {...props}
        render={render}
        size={multiline ? "sm-multiline" : size}
        variant={variant}
        className={className}
      >
        {children}
      </Button>
    );
  }
  return control;
}

/** Searchable context pickers share the same toolbar and panel density as selects. */
export function ThreadDetailsComboboxControl({
  panel,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof ComboboxTrigger>, "className"> & {
  panel: boolean;
  className?: string;
}) {
  return (
    <ComboboxTrigger
      {...props}
      render={
        panel ? (
          <ThreadDetailsControl part="select" className={className} />
        ) : (
          <ComposerControl size="xs" className={className} />
        )
      }
    >
      {children}
      <ChevronDownIcon
        className={panel ? THREAD_DETAILS_PANEL_CHEVRON_CLASS : "size-3 shrink-0 opacity-50"}
      />
    </ComboboxTrigger>
  );
}
