import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { PanelLeft, PanelLeftClose } from "lucide";
import * as React from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input, type InputProps } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { MorphIcon } from "~/components/MorphIcon";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useCollapsiblePanel,
} from "~/components/ui/resizable";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { resolveSidebarState, type ResponsiveSidebarState } from "./sidebarState";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = 16 * 16;
const SIDEBAR_WIDTH_MOBILE = "calc(100vw - var(--spacing(3)))";
const SIDEBAR_TITLEBAR_CONTROL_SIZE = "max-sm:[--workspace-titlebar-control-size:--spacing(8)]";

type SidebarContextProps = {
  state: ResponsiveSidebarState;
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  mobileSheetMounted: boolean;
  setMobileSheetElement: (element: HTMLDivElement | null) => void;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

type SidebarResizableOptions = {
  defaultWidth?: number;
  minWidth?: number;
  storageKey?: string;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.use(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function useSidebarVisibility() {
  const { isMobile, open, openMobile } = useSidebar();
  return isMobile ? openMobile : open;
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const [mobileSheetMounted, setMobileSheetMounted] = React.useState(false);
  const setMobileSheetElement = (element: HTMLDivElement | null) => {
    setMobileSheetMounted(element !== null);
  };

  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = async (value: boolean | ((value: boolean) => boolean)) => {
    const openState = typeof value === "function" ? value(open) : value;
    if (setOpenProp) {
      setOpenProp(openState);
    } else {
      _setOpen(openState);
    }

    await cookieStore.set({
      expires: Date.now() + SIDEBAR_COOKIE_MAX_AGE * 1000,
      name: SIDEBAR_COOKIE_NAME,
      path: "/",
      value: String(openState),
    });
  };

  const toggleSidebar = () => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open);
  };

  const state = resolveSidebarState({ isMobile, open, openMobile });

  const contextValue = {
    isMobile,
    open,
    openMobile,
    mobileSheetMounted,
    setMobileSheetElement,
    setOpen,
    setOpenMobile,
    state,
    toggleSidebar,
  };

  return (
    <SidebarContext value={contextValue}>
      <ResizablePanelGroup
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full",
          SIDEBAR_TITLEBAR_CONTROL_SIZE,
          className,
        )}
        data-sidebar-state={state}
        data-slot="sidebar-wrapper"
        style={
          {
            "--workspace-titlebar-content-left":
              "calc(var(--workspace-controls-left) + var(--workspace-titlebar-control-size) + var(--workspace-titlebar-control-gap))",
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
      </ResizablePanelGroup>
    </SidebarContext>
  );
}

function Sidebar({
  side = "left",
  resizable,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right";
  /** Omit for a fixed-width sidebar. */
  resizable?: SidebarResizableOptions;
}) {
  const { isMobile, open, setOpen, state, openMobile, setOpenMobile, setMobileSheetElement } =
    useSidebar();
  const defaultWidth = resizable?.defaultWidth ?? SIDEBAR_WIDTH;
  const { panelProps, handleProps } = useCollapsiblePanel({
    storageKey: resizable?.storageKey ?? null,
    defaultWidth,
    minWidth: resizable?.minWidth ?? defaultWidth,
    maxWidth: resizable ? undefined : defaultWidth,
    open,
    onCollapse: () => setOpen(false),
  });

  if (isMobile) {
    return (
      <Sheet onOpenChange={setOpenMobile} open={openMobile}>
        <SheetPopup
          ref={setMobileSheetElement}
          className={cn(
            "w-(--sidebar-width) max-w-none bg-sidebar surface-grain p-0 text-sidebar-foreground",
            className,
          )}
          data-mobile="true"
          data-sidebar="sidebar"
          data-slot="sidebar"
          showCloseButton={false}
          side={side}
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div
            className={cn(
              "flex h-full w-full flex-col pb-safe pt-safe",
              SIDEBAR_TITLEBAR_CONTROL_SIZE,
              side === "left" ? "pl-safe" : "pr-safe",
            )}
            {...props}
          >
            {children}
          </div>
        </SheetPopup>
      </Sheet>
    );
  }

  const panel = (
    <ResizablePanel
      {...panelProps}
      className={cn("flex", side === "left" && "justify-end")}
      data-sidebar-panel=""
      id={`sidebar-${side}`}
    >
      <div
        className="group flex h-full w-full text-sidebar-foreground"
        data-side={side}
        data-slot="sidebar"
        data-state={state}
      >
        <div
          className={cn("flex h-full w-full", side === "left" ? "border-r" : "border-l", className)}
          data-slot="sidebar-container"
          {...props}
        >
          <div
            className="flex h-full w-full flex-col bg-sidebar surface-grain"
            data-sidebar="sidebar"
            data-slot="sidebar-inner"
          >
            {children}
          </div>
        </div>
      </div>
    </ResizablePanel>
  );
  const handle = resizable ? (
    <ResizableHandle aria-label="Resize sidebar" {...handleProps} />
  ) : null;
  return side === "left" ? (
    <>
      {panel}
      {handle}
    </>
  ) : (
    <>
      {handle}
      {panel}
    </>
  );
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();
  const isOpen = useSidebarVisibility();

  return (
    <Button
      className={cn(
        "size-[var(--workspace-titlebar-control-size)]! [-webkit-app-region:no-drag]",
        className,
      )}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      aria-pressed={isOpen}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      size="icon"
      variant="ghost"
      {...props}
    >
      <MorphIcon className="size-4" icon={isOpen ? PanelLeftClose : PanelLeft} />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

function SidebarInput({ className, ...props }: Omit<InputProps, "unstyled" | "variant">) {
  return (
    <Input
      className={cn(
        "[&_[data-slot=input]]:h-auto [&_[data-slot=input]]:p-0 [&_[data-slot=input]]:font-medium [&_[data-slot=input]]:text-sidebar-foreground [&_[data-slot=input]]:text-sm [&_[data-slot=input]]:leading-normal [&_[data-slot=input]]:placeholder:text-sidebar-muted-foreground",
        className,
      )}
      unstyled
      {...props}
    />
  );
}

/**
 * The panel beside the sidebar. Mount it once around every route's
 * `SidebarInset`; the library treats all of the provider's children as layout items.
 */
function SidebarInsetPanel({
  minWidth,
  children,
}: {
  minWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <ResizablePanel
      className="flex"
      id="sidebar-inset"
      {...(minWidth !== undefined ? { minSize: minWidth } : {})}
    >
      {children}
    </ResizablePanel>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "relative flex min-w-0 w-full flex-1 flex-col bg-background surface-grain",
        className,
      )}
      data-slot="sidebar-inset"
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="header"
      data-slot="sidebar-header"
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 px-[var(--sidebar-content-inset)] py-1", className)}
      data-sidebar="footer"
      data-slot="sidebar-footer"
      {...props}
    />
  );
}

function SidebarContent({
  className,
  fixedHeader,
  ...props
}: React.ComponentProps<"div"> & {
  fixedHeader?: React.ReactNode;
}) {
  return (
    <>
      {fixedHeader ? <div className="w-full shrink-0">{fixedHeader}</div> : null}
      <ScrollArea
        hideScrollbars
        scrollFade
        scrollFadePadding={false}
        // Thread rows provide keyboard access to this scroll region. Keeping
        // Base UI's viewport out of the tab order lets its presentational role
        // flatten in WebKit instead of becoming a VoiceOver interaction group.
        viewportTabIndex={-1}
        className="h-auto min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]]:[--fade-size:0.75rem]"
      >
        <div
          className={cn(
            "flex w-full min-w-0 flex-col [overflow-anchor:none] [&>[data-sidebar=group]+[data-sidebar=group]]:pt-0",
            fixedHeader && "[&>[data-sidebar=group]:first-child]:pt-0",
            className,
          )}
          data-sidebar="content"
          data-slot="sidebar-content"
          {...props}
        />
      </ScrollArea>
    </>
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 flex-col p-[var(--sidebar-content-inset)]",
        className,
      )}
      data-sidebar="group"
      data-slot="sidebar-group"
      {...props}
    />
  );
}

function SidebarMenu({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"ul"> & { size?: "default" | "compact" }) {
  return (
    <ul
      className={cn(
        "flex w-full min-w-0 flex-col",
        size === "compact" ? "gap-0.75" : "gap-1",
        className,
      )}
      data-sidebar="menu"
      data-slot="sidebar-menu"
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn("group/menu-item relative", className)}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full cursor-pointer items-center gap-[var(--sidebar-control-gap)] overflow-hidden text-left outline-hidden ring-ring transition-[width,height,padding] hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset active:bg-sidebar-row-active active:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-64 aria-disabled:pointer-events-none aria-disabled:opacity-64 data-[active=true]:bg-sidebar-row-selected data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground data-[state=open]:hover:bg-sidebar-row-hover data-[state=open]:hover:text-sidebar-foreground [&>span:last-of-type]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--sidebar-icon-color)] hover:[&>svg]:text-sidebar-foreground active:[&>svg]:text-sidebar-foreground data-[active=true]:[&>svg]:text-sidebar-foreground",
  {
    compoundVariants: [{ size: "compact", variant: "default", class: "font-normal" }],
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        compact:
          "h-7 rounded-[var(--control-radius)] px-[calc(var(--sidebar-row-content-inset)-0.25rem)] py-1 text-sm",
        default:
          "h-8 rounded-[var(--control-radius)] px-[var(--sidebar-row-content-inset)] py-1.5 text-sm",
        icon: "size-8 justify-center rounded-[var(--control-radius)] p-0",
        lg: "h-12 rounded-lg p-2 text-sm",
        sm: "h-7 rounded-lg p-2 text-xs",
      },
      variant: {
        default: "font-medium text-sidebar-muted-foreground/80",
        outline: "bg-sidebar-control-surface ring-1 ring-sidebar-border",
      },
    },
  },
);

function SidebarMenuButton({
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  shortcut,
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<"button"> & {
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipPopup>;
  /** Shortcut label for the row's action. Touch layouts and disabled rows omit it. */
  shortcut?: string | null | undefined;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { isMobile, state } = useSidebar();

  const defaultProps = {
    className: cn(sidebarMenuButtonVariants({ size, variant }), className),
    "data-active": isActive,
    "data-sidebar": "menu-button",
    "data-size": size,
    "data-slot": "sidebar-menu-button",
  };

  const buttonProps = mergeProps<"button">(defaultProps, {
    ...props,
    children:
      shortcut && !isMobile && !props.disabled ? (
        <>
          {children}
          <Kbd
            variant="raised"
            className="ms-auto text-sidebar-muted-foreground opacity-0 transition-opacity group-hover/menu-item:opacity-100 in-focus-visible:opacity-100"
            data-sidebar="menu-shortcut"
            aria-hidden
          >
            {shortcut}
          </Kbd>
        </>
      ) : (
        children
      ),
  });

  const buttonElement = useRender({
    defaultTagName: "button",
    props: buttonProps,
    render,
  });

  if (!tooltip) {
    return buttonElement;
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    };
  }

  return (
    <Tooltip>
      <TooltipTrigger render={buttonElement as React.ReactElement<Record<string, unknown>>} />
      <TooltipPopup
        align="center"
        hidden={state !== "collapsed" || isMobile}
        side="right"
        {...tooltip}
      />
    </Tooltip>
  );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-sidebar-border border-l px-2.5 py-0.5",
        className,
      )}
      data-sidebar="menu-sub"
      data-slot="sidebar-menu-sub"
      {...props}
    />
  );
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn("group/menu-sub-item relative", className)}
      data-sidebar="menu-sub-item"
      data-slot="sidebar-menu-sub-item"
      {...props}
    />
  );
}

function SidebarMenuSubButton({
  size = "md",
  isActive = false,
  className,
  render,
  ...props
}: useRender.ComponentProps<"a"> & {
  size?: "sm" | "md";
  isActive?: boolean;
}) {
  const defaultProps = {
    className: cn(
      "-translate-x-px flex h-7 min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 text-sidebar-foreground outline-hidden ring-ring hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset active:bg-sidebar-row-active active:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-64 aria-disabled:pointer-events-none aria-disabled:opacity-64 [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-muted-foreground",
      "data-[active=true]:bg-sidebar-row-selected data-[active=true]:text-sidebar-foreground",
      size === "sm" && "text-xs",
      size === "md" && "text-sm",
      className,
    ),
    "data-active": isActive,
    "data-sidebar": "menu-sub-button",
    "data-size": size,
    "data-slot": "sidebar-menu-sub-button",
  };

  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(defaultProps, props),
    render,
  });
}

export {
  SidebarInput,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarInsetPanel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
  useSidebarVisibility,
};
